import type { Track } from '@shared/types'
import type { YtDlp } from './ytdlp'

interface Resolved {
  url: string
  headers: Record<string, string>
  hls: boolean
  at: number
}

const TTL = 15 * 60 * 1000
const CORS = { 'Access-Control-Allow-Origin': '*' }

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

/**
 * Потоковое воспроизведение «веб-треков». Ссылка на звук берётся через yt-dlp и проксируется в плеер:
 * обычные файлы — с поддержкой перемотки (Range), HLS (так отдаёт SoundCloud) — с переписанным плейлистом,
 * сегменты которого тоже идут через приложение (заголовки и подпись источника остаются на нашей стороне).
 */
export class StreamService {
  private cache = new Map<string, Resolved>()
  private inflight = new Map<string, Promise<Resolved>>()
  /** хосты, которые встречались в плейлистах трека: только на них разрешено ходить за сегментами */
  private hosts = new Map<string, Set<string>>()

  constructor(private yt: YtDlp) {}

  private resolve(t: Track, fresh: boolean): Promise<Resolved> {
    const hit = this.cache.get(t.id)
    if (hit && !fresh && Date.now() - hit.at < TTL) return Promise.resolve(hit)
    const running = this.inflight.get(t.id)
    if (running) return running
    const link = t.source.matchedUrl || t.source.url
    if (!link || !/^https?:\/\//i.test(link)) return Promise.reject(new Error('У трека нет ссылки на источник.'))
    const p = this.yt
      .streamInfo(link)
      .then((s) => {
        const r = { ...s, at: Date.now() }
        this.cache.set(t.id, r)
        if (s.hls) this.hosts.set(t.id, new Set([new URL(s.url).hostname]))
        return r
      })
      .finally(() => this.inflight.delete(t.id))
    this.inflight.set(t.id, p)
    return p
  }

  /** Что отдавать плееру: обычный файл или HLS-плейлист. */
  async info(t: Track): Promise<{ kind: 'file' | 'hls'; url: string }> {
    const s = await this.resolve(t, false)
    return s.hls ? { kind: 'hls', url: `wave://hls/${t.id}/index.m3u8` } : { kind: 'file', url: `wave://track/${t.id}` }
  }

  private async upstream(t: Track, url: string, req: Request, headersExtra: Record<string, string> = {}): Promise<Response> {
    let lastErr = 'нет ответа'
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await this.resolve(t, attempt > 0)
      const headers: Record<string, string> = { ...s.headers, ...headersExtra }
      const range = req.headers.get('range')
      if (range) headers['range'] = range
      try {
        // для HLS «исходная» ссылка может смениться после обновления подписи — повторный разбор делаем только на первой попытке
        const res = await fetch(attempt > 0 && s.hls && url === s.url ? s.url : url, { headers, signal: req.signal })
        if ([401, 403, 404, 410].includes(res.status) && attempt === 0) {
          this.cache.delete(t.id)
          lastErr = `HTTP ${res.status}`
          continue
        }
        return res
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
        this.cache.delete(t.id)
      }
    }
    throw new Error(lastErr)
  }

  private fail(t: Track, e: unknown): Response {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[stream]', t.title, msg)
    return new Response(msg, { status: 502, headers: CORS })
  }

  private passHeaders(up: Response): Headers {
    const out = new Headers({ ...CORS, 'Cache-Control': 'no-store' })
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = up.headers.get(h)
      if (v) out.set(h, v)
    }
    if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes')
    return out
  }

  /** Обычный файл (не HLS) с поддержкой Range. */
  async serve(t: Track, req: Request): Promise<Response> {
    try {
      const s = await this.resolve(t, false)
      if (s.hls) return new Response('Это HLS-поток: откройте плейлист', { status: 409, headers: CORS })
      const up = await this.upstream(t, s.url, req)
      return new Response(up.body, { status: up.status, headers: this.passHeaders(up) })
    } catch (e) {
      return this.fail(t, e)
    }
  }

  /** HLS-плейлист: адреса вариантов, сегментов и ключей переписываются на наши. */
  async serveManifest(t: Track, target: string | null, req: Request): Promise<Response> {
    try {
      const s = await this.resolve(t, false)
      const base = target ?? s.url
      const res = await this.upstream(t, base, new Request(req.url, { signal: req.signal }))
      if (!res.ok) return new Response(`HTTP ${res.status}`, { status: 502, headers: CORS })
      const text = await res.text()
      const hosts = this.hosts.get(t.id) ?? new Set<string>()
      this.hosts.set(t.id, hosts)
      const abs = (u: string) => {
        const a = new URL(u, base)
        hosts.add(a.hostname)
        return a.toString()
      }
      const seg = (u: string) => `wave://hlsseg/${t.id}?u=${b64(abs(u))}`
      const man = (u: string) => `wave://hls/${t.id}/index.m3u8?u=${b64(abs(u))}`
      const lines = text.split(/\r?\n/)
      let nextIsVariant = false
      const out = lines.map((line) => {
        if (!line.trim()) return line
        if (line.startsWith('#')) {
          if (line.startsWith('#EXT-X-STREAM-INF')) nextIsVariant = true
          return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${line.startsWith('#EXT-X-MEDIA') ? man(u) : seg(u)}"`)
        }
        const r = nextIsVariant ? man(line.trim()) : seg(line.trim())
        nextIsVariant = false
        return r
      })
      return new Response(out.join('\n'), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }
      })
    } catch (e) {
      return this.fail(t, e)
    }
  }

  /** Сегмент HLS (или ключ) по адресу из нашего плейлиста. */
  async serveSegment(t: Track, encoded: string, req: Request): Promise<Response> {
    try {
      const url = unb64(encoded)
      const u = new URL(url)
      if (!/^https?:$/.test(u.protocol) || !this.hosts.get(t.id)?.has(u.hostname)) return new Response('Forbidden', { status: 403, headers: CORS })
      const up = await this.upstream(t, url, req)
      return new Response(up.body, { status: up.status, headers: this.passHeaders(up) })
    } catch (e) {
      return this.fail(t, e)
    }
  }

  /** Подогревает ссылку заранее, чтобы старт воспроизведения был быстрее. */
  warm(t: Track): void {
    if (t.remote) void this.resolve(t, false).catch(() => {})
  }
}
