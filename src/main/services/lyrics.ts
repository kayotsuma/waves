import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { LyricLine, LyricsData, Track } from '@shared/types'
import type { LibraryService } from '../library'
import { lyricsDir } from '../paths'
import type { SettingsService } from '../settings'
import { fetchGeniusLyrics, fetchGeniusUrl } from './genius'
import { estimateSync, lyricsTitle, searchLrclib } from './lyricsSearch'
import { looksLikeLrc, parseLrc, stringifyLrc } from './lrc'
import { YandexClient } from './sources/yandex'
import { MIN_MATCH } from './align'

const SEARCH_VERSION = 2
const RETRY_ESTIMATED_MS = 3 * 24 * 3600 * 1000

export class LyricsService {
  /** у трека есть текст без точной синхронизации — можно выровнять по звуку (urgent — трек открыт у пользователя) */
  onNeedsAlign: (trackId: string, urgent: boolean) => void = () => {}

  constructor(
    private lib: LibraryService,
    private settings: SettingsService,
    /** огибающая громкости трека (из анализа) — помогает найти, где начинается пение */
    private peaks: (id: string) => Promise<number[] | null> = async () => null
  ) {}

  private async estimate(track: Track, plain: string): Promise<LyricLine[]> {
    let peaks: number[] | null = null
    try {
      peaks = await Promise.race([this.peaks(track.id), new Promise<null>((r) => setTimeout(() => r(null), 6000))])
    } catch {
      /* без огибающей — по длительности */
    }
    return estimateSync(plain, track.duration, peaks)
  }

  private file(id: string): string {
    return join(lyricsDir(), `${id}.json`)
  }

  get(trackId: string): LyricsData | null {
    try {
      const f = this.file(trackId)
      return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as LyricsData) : null
    } catch {
      return null
    }
  }

  private save(d: LyricsData): LyricsData {
    writeFileSync(this.file(d.trackId), JSON.stringify(d))
    return d
  }

  private sidecar(track: Track): string {
    if (track.remote) return ''
    return join(dirname(track.file), basename(track.file, extname(track.file)) + '.lrc')
  }

  /** Ищет тексты во всех источниках и кэширует результат. */
  async fetch(trackId: string, opts: { force?: boolean; genius?: boolean } = {}): Promise<LyricsData> {
    const track = this.lib.get(trackId)
    if (!track) throw new Error('Трек не найден')
    const cached = this.get(trackId)
    // приблизительная синхронизация и «текст без синхронизации от старой версии» — повод поискать точную ещё раз
    const weak = !!cached && (cached.syncedSource === 'estimated' || (!cached.synced && (cached.v ?? 1) < SEARCH_VERSION))
    const weakFresh = !!cached && cached.syncedSource === 'estimated' && Date.now() - cached.fetchedAt < RETRY_ESTIMATED_MS && (cached.v ?? 1) >= SEARCH_VERSION
    if (cached && !opts.force && (cached.synced || cached.plain) && (!weak || weakFresh)) {
      if (!opts.genius || cached.plainSource === 'genius') return cached
    }

    const keepSynced = !!cached && !opts.force && cached.syncedSource !== 'estimated'
    const data: LyricsData = {
      trackId,
      v: SEARCH_VERSION,
      offset: cached?.offset ?? 0,
      fetchedAt: Date.now(),
      ...(cached && !opts.force
        ? { synced: keepSynced ? cached.synced : undefined, plain: cached.plain, syncedSource: keepSynced ? cached.syncedSource : undefined, plainSource: cached.plainSource, geniusUrl: cached.geniusUrl }
        : {})
    }
    const dl = this.settings.get().download

    // 1. локальный .lrc рядом с файлом (при «Искать заново» не используем — мог быть записан нами же)
    if (!data.synced && !opts.force) {
      const sc = this.sidecar(track)
      if (existsSync(sc)) {
        try {
          const parsed = parseLrc(readFileSync(sc, 'utf8'))
          if (parsed.lines.length) {
            data.synced = parsed.lines
            data.syncedSource = 'file'
            data.offset = parsed.offset || data.offset
          }
        } catch {
          /* ignore */
        }
      }
    }

    // 2. Яндекс (для треков оттуда, нужен токен)
    if (!data.synced && track.source.kind === 'yandex' && track.source.id && dl.yandexToken) {
      try {
        const lrc = await new YandexClient(dl.yandexToken).lyricsLrc(track.source.id)
        if (lrc && looksLikeLrc(lrc)) {
          data.synced = parseLrc(lrc).lines
          data.syncedSource = 'yandex'
        }
      } catch (e) {
        console.warn('[lyrics] Яндекс:', e instanceof Error ? e.message : e)
      }
    }

    // 3. LRCLIB
    if (!data.synced || !data.plain) {
      let r = null as Awaited<ReturnType<typeof searchLrclib>>
      try {
        r = await searchLrclib(track)
      } catch (e) {
        console.warn('[lyrics] LRCLIB:', e instanceof Error ? e.message : e)
      }
      if (r?.synced && !data.synced) {
        const parsed = parseLrc(r.synced)
        if (parsed.lines.length) {
          data.synced = parsed.lines
          data.syncedSource = 'lrclib'
        }
      }
      if (r?.plain && !data.plain) {
        data.plain = r.plain
        data.plainSource = 'lrclib'
      }
    }

    // 4. Genius — обычный текст (если нет никакого, либо по запросу пользователя)
    if ((!data.synced && !data.plain) || opts.genius) {
      try {
        const g = await fetchGeniusLyrics(track.artists[0] ?? track.artist, lyricsTitle(track.title), dl.geniusToken)
        if (g.ok) {
          data.plain = g.text
          data.plainSource = 'genius'
          data.geniusUrl = g.url
          data.geniusNote = undefined
          data.geniusCandidates = undefined
        } else {
          data.geniusCandidates = g.candidates
          if (opts.genius) data.geniusNote = g.note
        }
      } catch (e) {
        console.warn('[lyrics] Genius:', e instanceof Error ? e.message : e)
      }
    }

    // текст сменился — выравнивание по звуку от старого текста не годится
    if (data.syncedSource === 'aligned' && cached?.plain !== data.plain) {
      data.synced = undefined
      data.syncedSource = undefined
    }

    // 5. точной синхронизации нет — раскладываем обычный текст по времени (помечается как «примерная»)
    if (!data.synced && data.plain) {
      const lines = await this.estimate(track, data.plain)
      if (lines.length) {
        data.synced = lines
        data.syncedSource = 'estimated'
      }
    }

    this.save(data)
    if (data.synced && data.syncedSource !== 'estimated' && dl.saveLrcFile) this.writeSidecar(track, data)
    if (data.plain && (!data.synced || data.syncedSource === 'estimated')) this.onNeedsAlign(trackId, true)
    return data
  }

  /**
   * Результат выравнивания по звуку. Применяется, только если текст с тех пор не менялся, точной синхронизации так и нет,
   * а текст подходит к звуку (иначе это, скорее всего, текст другой песни — остаётся примерная раскладка).
   */
  setAligned(trackId: string, plain: string, hash: string, r: { lines: LyricLine[]; match: number } | null): boolean {
    const data = this.get(trackId)
    const track = this.lib.get(trackId)
    if (!data || !track || data.plain !== plain) return false
    if (data.synced?.length && data.syncedSource !== 'estimated') return false
    data.alignAttempt = { plainHash: hash, match: r ? Math.round(r.match * 1000) / 1000 : 0, at: Date.now() }
    const ok = !!r && r.match >= MIN_MATCH && r.lines.length > 0
    if (ok) {
      data.synced = r.lines
      data.syncedSource = 'aligned'
    }
    this.save(data)
    if (ok && this.settings.get().download.saveLrcFile) this.writeSidecar(track, data)
    return ok
  }

  /** Текст по ссылке Genius, которую выбрал/вставил пользователь. */
  async setGeniusUrl(trackId: string, url: string): Promise<LyricsData> {
    if (!this.lib.get(trackId)) throw new Error('Трек не найден')
    const g = await fetchGeniusUrl(url)
    if (!g.ok) throw new Error(g.note)
    const prev = this.get(trackId)
    const data: LyricsData = { ...(prev ?? { trackId, offset: 0 }), trackId, fetchedAt: Date.now() } as LyricsData
    data.plain = g.text
    data.plainSource = 'genius'
    data.geniusUrl = g.url
    data.geniusNote = undefined
    data.geniusCandidates = undefined
    data.v = SEARCH_VERSION
    // для нового текста старая приблизительная раскладка (и выравнивание по старому тексту) не годится
    if (!data.synced || data.syncedSource === 'estimated' || data.syncedSource === 'aligned') {
      const track = this.lib.get(trackId)
      const lines = track ? await this.estimate(track, g.text) : []
      data.synced = lines.length ? lines : undefined
      data.syncedSource = lines.length ? 'estimated' : undefined
    }
    this.save(data)
    if (data.syncedSource === 'estimated') this.onNeedsAlign(trackId, true)
    return data
  }

  /** Ручной ввод: LRC с метками или простой текст. */
  setManual(trackId: string, text: string): LyricsData {
    const prev = this.get(trackId)
    const data: LyricsData = { ...(prev ?? { trackId, offset: 0 }), trackId, fetchedAt: Date.now() } as LyricsData
    if (looksLikeLrc(text)) {
      const parsed = parseLrc(text)
      data.synced = parsed.lines
      data.syncedSource = 'manual'
      data.offset = parsed.offset
    } else {
      data.plain = text.trim()
      data.plainSource = 'manual'
      if (data.syncedSource === 'aligned' || data.syncedSource === 'estimated') {
        data.synced = undefined
        data.syncedSource = undefined
      }
    }
    this.save(data)
    if (data.plain && !data.synced) this.onNeedsAlign(trackId, true)
    const t = this.lib.get(trackId)
    if (t && data.synced && this.settings.get().download.saveLrcFile) this.writeSidecar(t, data)
    return data
  }

  /** Результат ручной тайм-разметки (режим «простукивания»). */
  setSynced(trackId: string, input: LyricLine[]): LyricsData {
    const lines = (Array.isArray(input) ? input : [])
      .filter((l) => l && Number.isFinite(l.t) && typeof l.text === 'string')
      .map((l) => ({ t: Math.max(0, l.t), text: l.text.slice(0, 500) }))
      .sort((a, b) => a.t - b.t)
    const prev = this.get(trackId) ?? ({ trackId, offset: 0, fetchedAt: Date.now() } as LyricsData)
    prev.synced = lines
    prev.syncedSource = 'manual'
    prev.offset = 0
    this.save(prev)
    const t = this.lib.get(trackId)
    if (t && this.settings.get().download.saveLrcFile) this.writeSidecar(t, prev)
    return prev
  }

  setOffset(trackId: string, offset: number): LyricsData | null {
    const d = this.get(trackId)
    if (!d) return null
    d.offset = Math.max(-10, Math.min(10, offset))
    return this.save(d)
  }

  private writeSidecar(track: Track, data: LyricsData): void {
    if (!data.synced || track.source.kind === 'local' || track.remote) return
    try {
      writeFileSync(this.sidecar(track), stringifyLrc(data.synced, 0))
    } catch {
      /* каталог мог стать недоступным */
    }
  }
}
