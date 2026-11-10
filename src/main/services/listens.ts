import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ListenBaseline, ListenInfo, ListenMeta, ListenRow, ListenYear, Track } from '@shared/types'
import type { LibraryService } from '../library'
import { dataDir } from '../paths'
import { JsonStore } from '../store'

/**
 * История прослушиваний: каждое прослушивание — [трек, когда начали, сколько секунд звучало].
 * Хранится по годам (listens/2026.json), чтобы файл не рос бесконечно и итоги года читались быстро.
 * Названия треков запоминаются рядом — статистика не теряет треки, удалённые из медиатеки.
 *
 * Плеер присылает «пульс» каждые ~15 секунд с накопленным временем; одно прослушивание обновляется на месте
 * по ключу сессии, поэтому при закрытии окна теряется не больше одного пульса.
 */

interface YearFile {
  rows: ListenRow[]
  meta: Record<string, ListenMeta>
}

const dir = () => join(dataDir(), 'listens')
const yearOf = (ms: number) => new Date(ms).getFullYear()

export class ListensService {
  private years = new Map<number, JsonStore<YearFile>>()
  /** ключ сессии плеера → [год, индекс строки] */
  private sessions = new Map<string, [number, number]>()
  private base: JsonStore<{ baseline: ListenBaseline | null; since: number }>

  constructor(private lib: LibraryService) {
    this.base = new JsonStore<{ baseline: ListenBaseline | null; since: number }>(join(dir(), 'baseline.json'), { baseline: null, since: 0 })
    if (!this.base.data.since) this.seedBaseline()
  }

  /**
   * Истории раньше не было, а счётчики прослушиваний — были. Запоминаем их один раз как «приблизительную»
   * часть статистики, иначе итоги первого года были бы пустыми.
   */
  private seedBaseline(): void {
    const tracks: ListenBaseline['tracks'] = {}
    for (const t of this.lib.allTracks()) {
      if (t.plays > 0) tracks[t.id] = { plays: t.plays, last: t.lastPlayedAt ?? t.addedAt, meta: metaOf(t) }
    }
    const now = Date.now()
    this.base.data = { baseline: Object.keys(tracks).length ? { at: now, tracks } : null, since: now }
    this.base.flush()
  }

  private year(y: number): JsonStore<YearFile> {
    let s = this.years.get(y)
    if (!s) {
      s = new JsonStore<YearFile>(join(dir(), `${y}.json`), { rows: [], meta: {} }, (l, d) => {
        const o = l as Partial<YearFile>
        return { rows: Array.isArray(o?.rows) ? o.rows.filter((r) => Array.isArray(r) && r.length === 3) : d.rows, meta: o?.meta && typeof o.meta === 'object' ? o.meta : d.meta }
      })
      this.years.set(y, s)
    }
    return s
  }

  /** Пульс плеера: у сессии `session` трек `trackId`, начавшийся в `startedAt`, звучал `seconds` секунд. */
  tick(session: string, trackId: string, startedAt: number, seconds: number): void {
    const t = this.lib.get(trackId)
    if (!t || !(seconds > 0)) return
    const s = Math.min(Math.round(seconds), Math.max(60, Math.round((t.duration || 600) * 3)))
    const at = Math.min(Date.now(), Math.max(0, Math.round(startedAt)))
    const known = this.sessions.get(session)
    if (known) {
      const [y, i] = known
      const store = this.year(y)
      const row = store.data.rows[i]
      if (row && row[0] === trackId) {
        if (s > row[2]) {
          row[2] = s
          store.save(2000)
        }
        return
      }
    }
    const y = yearOf(at)
    const store = this.year(y)
    store.data.rows.push([trackId, at, s])
    store.data.meta[trackId] = metaOf(t)
    this.sessions.set(session, [y, store.data.rows.length - 1])
    if (this.sessions.size > 50) this.sessions.delete(this.sessions.keys().next().value!)
    store.save(2000)
  }

  info(): ListenInfo {
    const years = new Set<number>()
    if (existsSync(dir())) for (const f of readdirSync(dir())) if (/^\d{4}\.json$/.test(f)) years.add(Number(f.slice(0, 4)))
    for (const [y, s] of this.years) if (s.data.rows.length) years.add(y)
    return { years: [...years].sort((a, b) => b - a), since: this.base.data.since, baseline: this.base.data.baseline }
  }

  get(y: number): ListenYear {
    const s = this.year(Math.round(y))
    // свежие названия: трек могли переименовать
    const meta = { ...s.data.meta }
    for (const id of Object.keys(meta)) {
      const t = this.lib.get(id)
      if (t) meta[id] = metaOf(t)
    }
    return { year: y, rows: s.data.rows, meta }
  }

  flush(): void {
    for (const s of this.years.values()) s.flush()
    this.base.flush()
  }
}

function metaOf(t: Track): ListenMeta {
  return { title: t.title, artist: t.artist, artists: t.artists, album: t.album, duration: t.duration }
}
