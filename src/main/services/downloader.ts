import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { DownloadJob, ImportItem, Track } from '@shared/types'
import type { LibraryService } from '../library'
import { coversDir, tmpDir } from '../paths'
import type { SettingsService } from '../settings'
import { dataDir } from '../paths'
import { JsonStore } from '../store'
import { errMsg, fetchBuffer, HttpError, sanitizeFilename, stripFeat } from '../util'
import type { Binaries } from './binaries'
import { measureLoudness, squareCover, writeTags } from './ffmpeg'
import type { LyricsService } from './lyrics'
import { findBestMatch } from './matcher'
import { probeAudio } from './probe'
import { spotifyTrackExtras } from './sources/spotify'
import { YandexClient } from './sources/yandex'
import type { YtDlp } from './ytdlp'

interface CoverJob {
  id: string
  /** готовый адрес обложки, если он известен */
  url?: string
  /** страница трека — откуда адрес обложки можно узнать */
  page?: string
  kind?: string
}

interface Deps {
  yt: YtDlp
  bins: Binaries
  lib: LibraryService
  settings: SettingsService
  lyrics: LyricsService
}

export class DownloadManager {
  private jobs = new Map<string, DownloadJob>()
  private controllers = new Map<string, AbortController>()
  private playlistOf = new Map<string, string>()
  private likeJobs = new Set<string>()
  private overrideUrl = new Map<string, string>()
  private queue: string[] = []
  private running = 0
  onUpdate: (job: DownloadJob) => void = () => {}
  onRemove: (ids: string[]) => void = () => {}

  constructor(private d: Deps) {}

  list(): DownloadJob[] {
    return [...this.jobs.values()]
  }

  enqueue(items: ImportItem[], opts: { playlistId?: string; like?: boolean } = {}): DownloadJob[] {
    const created: DownloadJob[] = []
    for (const item of items) {
      if (!item || typeof item.key !== 'string' || !item.fetch) continue
      if (item.fetch.type === 'url' && !/^https?:\/\//i.test(item.fetch.url)) continue
      const known = item.source.id ? this.d.lib.findBySource(item.source.kind, item.source.id) : undefined
      if (known) {
        if (opts.playlistId) this.d.lib.addToPlaylist(opts.playlistId, [known.id])
        if (opts.like && !known.liked) this.d.lib.update(known.id, { liked: true, likedAt: Date.now() })
        continue
      }
      // тот же элемент уже в очереди
      const dup = [...this.jobs.values()].find((j) => j.item.key === item.key && ['queued', 'matching', 'downloading', 'processing'].includes(j.status))
      if (dup) {
        if (opts.playlistId) this.playlistOf.set(dup.id, opts.playlistId)
        if (opts.like) this.likeJobs.add(dup.id)
        continue
      }
      const job: DownloadJob = { id: randomUUID(), item, status: 'queued', progress: 0, createdAt: Date.now() }
      this.jobs.set(job.id, job)
      if (opts.playlistId) this.playlistOf.set(job.id, opts.playlistId)
      if (opts.like) this.likeJobs.add(job.id)
      this.queue.push(job.id)
      created.push(job)
      this.onUpdate(job)
    }
    this.pump()
    return created
  }

  /**
   * «Веб-импорт»: добавляет треки в библиотеку без скачивания файла. Звук берётся из интернета при воспроизведении.
   * Работает для прямых ссылок (YouTube, SoundCloud и др.); остальное (Spotify/Apple/Deezer/Яндекс — их звук ищется через поиск) качается как обычно.
   */
  addRemote(items: ImportItem[], opts: { playlistId?: string; like?: boolean } = {}): { added: number; download: ImportItem[] } {
    let added = 0
    const download: ImportItem[] = []
    const covers: CoverJob[] = []
    for (const item of items) {
      if (!item || typeof item.key !== 'string' || !item.fetch) continue
      if (item.fetch.type !== 'url' || !/^https?:\/\//i.test(item.fetch.url)) {
        download.push(item)
        continue
      }
      const known = item.source.id ? this.d.lib.findBySource(item.source.kind, item.source.id) : undefined
      let track = known
      if (!track) {
        track = this.d.lib.add({
          title: item.title,
          artist: item.artists.join(', ') || 'Unknown Artist',
          artists: item.artists.length ? item.artists : ['Unknown Artist'],
          album: item.album,
          year: item.year,
          duration: item.duration ?? 0,
          file: '',
          hasCover: false,
          size: 0,
          source: { ...item.source, url: item.fetch.url },
          remote: true
        })
        added++
      }
      // у плоского списка SoundCloud превью нет — адрес обложки тогда ищется по ссылке на трек
      if (!track.hasCover) covers.push({ id: track.id, url: item.coverUrl, page: item.fetch.url, kind: item.source.kind })
      if (opts.playlistId) this.d.lib.addToPlaylist(opts.playlistId, [track.id])
      if (opts.like && !track.liked) this.d.lib.update(track.id, { liked: true, likedAt: Date.now() })
    }
    void this.fetchCovers(covers)
    return { added, download }
  }

  /** Адрес обложки для трека, у которого его нет в списке: SoundCloud — через oEmbed, остальное — через yt-dlp. */
  private async findCoverUrl(page: string, kind: string): Promise<string | undefined> {
    if (kind === 'soundcloud') {
      try {
        const r = await fetchBuffer(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(page)}`, { timeout: 15000 })
        const u = JSON.parse(r.toString('utf8'))?.thumbnail_url
        // в oEmbed картинка 500×500 — максимум, что SoundCloud отдаёт без авторизации
        if (typeof u === 'string' && /^https?:/.test(u)) return u
      } catch (e) {
        // у части треков встраивание запрещено владельцем (403) — тогда спрашиваем yt-dlp; сетевые сбои пробрасываем
        if (!(e instanceof HttpError)) throw e
      }
    }
    const j = await this.d.yt.json(page, ['--no-playlist', '--skip-download'])
    const thumbs: { url?: string; width?: number }[] = Array.isArray(j?.thumbnails) ? j.thumbnails : []
    const best = [...thumbs].filter((t) => t.url).sort((x, y) => (x.width ?? 0) - (y.width ?? 0)).at(-1)?.url
    return best ?? j?.thumbnail
  }

  private coverTried: JsonStore<{ v: number; ids: string[] }> | null = null
  private triedIds = new Set<string>()
  private coversBusy = false
  private pendingCovers: CoverJob[] = []

  /** Список «уже искали обложку». Версия 2: записи без версии (до запасного пути через yt-dlp) игнорируются. */
  private get tried(): JsonStore<{ v: number; ids: string[] }> {
    if (!this.coverTried) {
      this.coverTried = new JsonStore<{ v: number; ids: string[] }>(join(dataDir(), 'cover-tried.json'), { v: 2, ids: [] }, (l) => {
        const o = l as { v?: number; ids?: unknown }
        return { v: 2, ids: o?.v === 2 && Array.isArray(o.ids) ? (o.ids as string[]) : [] }
      })
      this.triedIds = new Set(this.coverTried.data.ids)
    }
    return this.coverTried
  }

  private markTried(id: string): void {
    this.tried
    this.triedIds.add(id)
    this.tried.data.ids = [...this.triedIds]
    this.tried.save(1500)
  }

  flush(): void {
    this.coverTried?.flush()
  }

  /** Веб-треки без обложки (импортированные раньше или с неудачной попыткой) — дозаполнить в фоне. */
  backfillCovers(): void {
    this.tried
    const jobs: CoverJob[] = []
    for (const t of this.d.lib.allTracks()) {
      if (!t.remote || t.hasCover || this.triedIds.has(t.id) || !t.source.url) continue
      jobs.push({ id: t.id, page: t.source.url, kind: t.source.kind })
    }
    if (jobs.length) void this.fetchCovers(jobs)
  }

  /** Обложки веб-треков подтягиваются в фоне, по нескольку штук за раз; очереди разных вызовов объединяются. */
  private async fetchCovers(list: CoverJob[]): Promise<void> {
    const ffmpeg = this.d.bins.ffmpegPath
    if (!ffmpeg) return
    this.tried
    for (const j of list) if (!this.pendingCovers.some((x) => x.id === j.id)) this.pendingCovers.push(j)
    if (this.coversBusy) return
    this.coversBusy = true
    const worker = async () => {
      for (;;) {
        const job = this.pendingCovers.shift()
        if (!job) return
        const { id } = job
        const work = join(tmpDir(), `cv-${id}`)
        try {
          const t = this.d.lib.get(id)
          if (!t || t.hasCover) continue
          mkdirSync(work, { recursive: true })
          const url = job.url ?? (job.page ? await this.findCoverUrl(job.page, job.kind ?? 'other') : undefined)
          if (!url) {
            this.markTried(id)
            continue
          }
          const raw = join(work, 'cover.src')
          const out = join(work, 'cover.jpg')
          writeFileSync(raw, await fetchBuffer(url, { timeout: 20000 }))
          if (await squareCover(ffmpeg, raw, out)) {
            copyFileSync(out, join(coversDir(), `${id}.jpg`))
            this.d.lib.update(id, { hasCover: true, coverRev: (t.coverRev ?? 0) + 1 })
          }
          this.markTried(id)
        } catch (e) {
          // трек удалён или закрыт (404/403/401) — не мучаем его на каждом запуске; сеть/таймаут — попробуем позже
          if (e instanceof HttpError && [401, 403, 404, 410].includes(e.status)) this.markTried(id)
          else console.warn('[cover]', id, errMsg(e))
        } finally {
          rmSync(work, { recursive: true, force: true })
        }
        await new Promise((r) => setTimeout(r, 120))
      }
    }
    try {
      await Promise.all([worker(), worker(), worker()])
    } finally {
      this.coversBusy = false
      this.tried.flush()
    }
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'queued') {
      this.queue = this.queue.filter((x) => x !== id)
      this.patch(job, { status: 'canceled', detail: 'Отменено' })
    } else {
      this.controllers.get(id)?.abort()
    }
  }

  retry(id: string, overrideUrl?: string): void {
    const job = this.jobs.get(id)
    if (!job || !['error', 'canceled'].includes(job.status)) return
    if (overrideUrl) this.overrideUrl.set(id, overrideUrl)
    this.patch(job, { status: 'queued', progress: 0, error: undefined, detail: undefined, speed: undefined, eta: undefined })
    this.queue.push(id)
    this.pump()
  }

  clearFinished(): void {
    const ids: string[] = []
    for (const [id, j] of this.jobs) {
      if (['done', 'error', 'canceled'].includes(j.status)) {
        this.jobs.delete(id)
        ids.push(id)
      }
    }
    if (ids.length) this.onRemove(ids)
  }

  private patch(job: DownloadJob, p: Partial<DownloadJob>): void {
    Object.assign(job, p)
    this.onUpdate(job)
  }

  private pump(): void {
    const max = this.d.settings.get().download.concurrency
    while (this.running < max && this.queue.length) {
      const id = this.queue.shift()!
      const job = this.jobs.get(id)
      if (!job || job.status !== 'queued') continue
      this.running++
      void this.run(job).finally(() => {
        this.running--
        this.pump()
      })
    }
  }

  private async run(job: DownloadJob): Promise<void> {
    const ac = new AbortController()
    this.controllers.set(job.id, ac)
    const work = join(tmpDir(), job.id)
    try {
      mkdirSync(work, { recursive: true })
      const track = await this.process(job, work, ac.signal)
      this.patch(job, { status: 'done', progress: 100, trackId: track.id, error: undefined, speed: undefined, eta: undefined })
      const pl = this.playlistOf.get(job.id)
      if (pl) this.d.lib.addToPlaylist(pl, [track.id])
      if (this.likeJobs.delete(job.id)) this.d.lib.update(track.id, { liked: true, likedAt: Date.now() })
      if (this.d.settings.get().download.autoLyrics) {
        this.d.lyrics.fetch(track.id).catch((e) => console.warn('[lyrics] авто-загрузка не удалась:', errMsg(e)))
      }
    } catch (e) {
      if (ac.signal.aborted) this.patch(job, { status: 'canceled', detail: 'Отменено', speed: undefined, eta: undefined })
      else {
        console.error('[download]', job.item.title, e)
        this.patch(job, { status: 'error', error: errMsg(e), speed: undefined, eta: undefined })
      }
    } finally {
      this.controllers.delete(job.id)
      this.overrideUrl.delete(job.id)
      rmSync(work, { recursive: true, force: true })
    }
  }

  private async process(job: DownloadJob, work: string, signal: AbortSignal): Promise<Track> {
    const { yt, bins, lib, settings } = this.d
    const item = job.item
    const dl = settings.get().download
    const ffmpeg = bins.ffmpegPath
    if (!ffmpeg) throw new Error('ffmpeg не найден — без него нельзя обработать аудио.')

    let audioFile: string | undefined
    let thumbFile: string | undefined
    let info: any = {}
    let detail = ''
    let matchedUrl: string | undefined

    // 1а. Яндекс: оригинал напрямую, если есть токен
    if (item.fetch.type === 'yandex' && dl.yandexToken && !this.overrideUrl.has(job.id)) {
      this.patch(job, { status: 'downloading', detail: 'Яндекс Музыка · оригинал…', progress: 0 })
      try {
        const r = await new YandexClient(dl.yandexToken).download(
          item.fetch.trackId,
          join(work, 'audio'),
          (p) => this.patch(job, { progress: p }),
          signal
        )
        audioFile = r.file
        detail = r.detail
      } catch (e) {
        if (signal.aborted) throw e
        console.warn('[yandex] прямая загрузка не удалась, ищу на YouTube:', errMsg(e))
      }
    }

    // 1б. yt-dlp: по ссылке либо через поиск соответствия
    if (!audioFile) {
      let url = this.overrideUrl.get(job.id)
      if (!url && item.fetch.type === 'url') url = item.fetch.url
      if (!url) {
        this.patch(job, { status: 'matching', detail: 'Ищу лучший источник…', progress: 0 })
        const query =
          item.fetch.type === 'search' ? item.fetch.query : `${item.artists.slice(0, 2).join(' ')} ${stripFeat(item.title)}`
        const m = await findBestMatch(yt, item, query, signal)
        if (!m) throw new Error('Не нашёл подходящий трек на YouTube. Нажмите «Указать ссылку» и вставьте нужное видео.')
        url = m.candidate.url
        matchedUrl = url
      }
      this.patch(job, { status: 'downloading', detail: 'Скачиваю…', progress: 0 })
      const r = await yt.download(
        url,
        work,
        (p) => this.patch(job, { progress: p.percent, speed: p.speed, eta: p.eta }),
        (stage) => stage === 'extract' && this.patch(job, { status: 'processing', detail: 'Извлекаю аудио…', progress: 100 }),
        signal
      )
      audioFile = r.audioFile
      thumbFile = r.thumbFile
      info = r.info
    }

    // 2. метаданные
    this.patch(job, { status: 'processing', detail: 'Теги и обложка…', progress: 100, speed: undefined, eta: undefined })
    let title = item.title
    let artists = item.artists
    let album = item.album
    let year = item.year
    let coverUrl = item.coverUrl
    if (item.source.kind === 'youtube' && item.fetch.type === 'url') {
      if (info.track && info.artist) {
        title = info.track
        artists = String(info.artist).split(/\s*,\s*/).filter(Boolean)
      }
      album = info.album || album
      year = info.release_year || year
      coverUrl = undefined // у YouTube берём обложку из yt-dlp (лучшее разрешение)
    }
    if (item.source.kind === 'spotify' && item.source.id && (!coverUrl || !album)) {
      const ex = await spotifyTrackExtras(item.source.id)
      coverUrl = coverUrl ?? ex.coverUrl
      album = album ?? ex.album
      year = year ?? ex.year
    }

    // 3. обложка → квадрат
    const coverOut = join(work, 'cover.jpg')
    let haveCover = false
    if (coverUrl) {
      try {
        const raw = join(work, 'cover.src')
        writeFileSync(raw, await fetchBuffer(coverUrl, { timeout: 20000 }))
        haveCover = await squareCover(ffmpeg, raw, coverOut)
      } catch (e) {
        console.warn('[cover] не удалось скачать обложку:', errMsg(e))
      }
    }
    if (!haveCover && thumbFile) haveCover = await squareCover(ffmpeg, thumbFile, coverOut)

    // 4. итоговый файл
    mkdirSync(dl.musicDir, { recursive: true })
    const ext = extname(audioFile).slice(1).toLowerCase()
    const artist = artists.join(', ')
    const base = sanitizeFilename(`${artist} - ${title}`)
    let dest = join(dl.musicDir, `${base}.${ext}`)
    for (let n = 2; existsSync(dest); n++) dest = join(dl.musicDir, `${base} (${n}).${ext}`)

    const tagged = await writeTags(ffmpeg, audioFile, dest, ext, { title, artist, album, year }, haveCover ? coverOut : undefined)
    if (!tagged) copyFileSync(audioFile, dest)

    // 5. технические параметры + громкость
    const probed = await probeAudio(dest)
    const loud = await measureLoudness(ffmpeg, dest).catch(() => ({}) as { loudness?: number; peak?: number })

    const id = randomUUID()
    if (haveCover) copyFileSync(coverOut, join(coversDir(), `${id}.jpg`))

    const track = lib.add({
      id,
      title,
      artist,
      artists,
      album,
      year,
      duration: probed.duration || item.duration || 0,
      file: dest,
      hasCover: haveCover,
      size: probed.size,
      codec: probed.codec,
      bitrate: probed.bitrate,
      sampleRate: probed.sampleRate,
      bitDepth: probed.bitDepth,
      lossless: probed.lossless,
      loudness: loud.loudness,
      peak: loud.peak,
      source: { ...item.source, matchedUrl }
    })
    this.patch(job, {
      detail: detail || `${(probed.codec ?? ext).toUpperCase()}${probed.bitrate ? ` · ${probed.bitrate} kbps` : ''}`
    })
    return track
  }
}
