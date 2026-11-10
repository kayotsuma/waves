import { createDecipheriv, createHash, createHmac } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ImportItem, ImportPreview } from '@shared/types'


// ВНИМАНИЕ: этот модуль написан по описанию неофициального API Яндекс Музыки и не проверялся
// на живом аккаунте (из среды разработки API недоступен — HTTP 451). Все сетевые вызовы
// обёрнуты так, что при любой ошибке загрузчик откатывается к поиску на YouTube.

const API = 'https://api.music.yandex.net'
const SIGN_KEY = 'kzqU4XhfCaY6B6JTHODeq5'
const MP3_SALT = 'XGRlBW9FXlekgbPrRHuSiA'
export const YANDEX_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d'
export const YANDEX_AUTH_URL = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${YANDEX_CLIENT_ID}`

type Parsed =
  | { type: 'track'; trackId: string; albumId?: string }
  | { type: 'album'; albumId: string }
  | { type: 'playlist'; user: string; kind: string }
  | { type: 'playlist-uuid'; uuid: string }
  | { type: 'artist'; artistId: string }

export function isYandexUrl(s: string): boolean {
  return /^https?:\/\/(?:[\w-]+\.)?music\.yandex\.(?:ru|com|by|kz|uz|net)\//i.test(s)
}

export function parseYandex(input: string): Parsed | null {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }
  const p = u.pathname
  let m: RegExpMatchArray | null
  if ((m = p.match(/\/album\/(\d+)\/track\/(\d+)/))) return { type: 'track', albumId: m[1], trackId: m[2] }
  if ((m = p.match(/\/track\/(\d+)/))) return { type: 'track', trackId: m[1] }
  if ((m = p.match(/\/album\/(\d+)/))) return { type: 'album', albumId: m[1] }
  if ((m = p.match(/\/users\/([^/]+)\/playlists\/(\d+)/))) return { type: 'playlist', user: decodeURIComponent(m[1]), kind: m[2] }
  if ((m = p.match(/\/playlists\/([\w-]{8,})/))) return { type: 'playlist-uuid', uuid: m[1] }
  if ((m = p.match(/\/artist\/(\d+)/))) return { type: 'artist', artistId: m[1] }
  return null
}

function coverUrl(uri: string | undefined, size = 1000): string | undefined {
  return uri ? `https://${uri.replace('%%', `${size}x${size}`)}` : undefined
}

function toItem(t: any): ImportItem | null {
  if (!t || (t.available === false && !t.title)) return null
  const id = String(t.realId ?? t.id).split(':')[0]
  const album = t.albums?.[0]
  const artists: string[] = (t.artists ?? []).map((a: any) => a.name).filter(Boolean)
  const title = t.version ? `${t.title} (${t.version})` : t.title
  if (!id || !title) return null
  return {
    key: `yandex:${id}`,
    title,
    artists: artists.length ? artists : ['Unknown Artist'],
    album: album?.title,
    year: album?.year ?? undefined,
    duration: t.durationMs ? t.durationMs / 1000 : undefined,
    coverUrl: coverUrl(t.coverUri ?? album?.coverUri),
    source: { kind: 'yandex', id, url: album?.id ? `https://music.yandex.ru/album/${album.id}/track/${id}` : `https://music.yandex.ru/track/${id}` },
    fetch: { type: 'yandex', trackId: id, albumId: album?.id ? String(album.id) : undefined }
  }
}

export class YandexClient {
  constructor(private token: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'user-agent': 'Yandex-Music-API',
      'x-yandex-music-client': 'YandexMusicAndroid/24023231',
      ...(this.token ? { authorization: `OAuth ${this.token}` } : {}),
      ...extra
    }
  }

  private async call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: this.headers(init.headers as Record<string, string>),
      signal: AbortSignal.timeout(20000)
    })
    if (res.status === 451) throw new Error('Яндекс Музыка недоступна из вашей сети (HTTP 451). Нужен российский IP или VPN.')
    if (res.status === 401 || res.status === 403) throw new Error('Яндекс отклонил токен. Войдите заново в Настройки → Аккаунты.')
    if (!res.ok) throw new Error(`Яндекс Музыка: HTTP ${res.status}`)
    const j: any = await res.json()
    return j.result as T
  }

  tracksByIds(ids: string[]): Promise<any[]> {
    return this.call('/tracks', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'track-ids': ids.join(','), 'with-positions': 'True' }).toString()
    })
  }

  async resolve(input: string): Promise<ImportPreview> {
    const parsed = parseYandex(input)
    if (!parsed) throw new Error('Не удалось распознать ссылку Яндекс Музыки.')
    const notes: string[] = []
    if (!this.token)
      notes.push('Токен Яндекса не задан: треки будут найдены на YouTube Music. Войдите в Настройки → Аккаунты, чтобы качать оригинал (до FLAC с Plus).')

    if (parsed.type === 'track') {
      const [t] = await this.tracksByIds([parsed.albumId ? `${parsed.trackId}:${parsed.albumId}` : parsed.trackId])
      const item = toItem(t)
      if (!item) throw new Error('Трек недоступен.')
      return { sourceKind: 'yandex', url: input, kind: 'track', title: item.title, subtitle: item.artists.join(', '), coverUrl: item.coverUrl, items: [item], notes }
    }

    if (parsed.type === 'album') {
      const a = await this.call<any>(`/albums/${parsed.albumId}/with-tracks`)
      const items = ((a.volumes ?? []) as any[][]).flat().map(toItem).filter(Boolean) as ImportItem[]
      return {
        sourceKind: 'yandex', url: input, kind: 'album', title: a.title, subtitle: (a.artists ?? []).map((x: any) => x.name).join(', '),
        coverUrl: coverUrl(a.coverUri), items, notes
      }
    }

    if (parsed.type === 'artist') {
      const r = await this.call<any>(`/artists/${parsed.artistId}/tracks?page=0&page-size=100`)
      const items = ((r.tracks ?? []) as any[]).map(toItem).filter(Boolean) as ImportItem[]
      return { sourceKind: 'yandex', url: input, kind: 'artist', title: 'Популярные треки', items, coverUrl: items[0]?.coverUrl, notes }
    }

    const pl =
      parsed.type === 'playlist'
        ? await this.call<any>(`/users/${encodeURIComponent(parsed.user)}/playlists/${parsed.kind}`)
        : await this.call<any>(`/playlist/${parsed.uuid}`)
    const entries: any[] = pl.tracks ?? []
    // В ответе трек может быть без полного описания — добираем пачками.
    const need = entries.filter((e) => !e.track).map((e) => (e.albumId ? `${e.id}:${e.albumId}` : String(e.id)))
    const fetched = new Map<string, any>()
    for (let i = 0; i < need.length; i += 100) {
      for (const t of await this.tracksByIds(need.slice(i, i + 100))) fetched.set(String(t.id).split(':')[0], t)
    }
    const items = entries
      .map((e) => toItem(e.track ?? fetched.get(String(e.id).split(':')[0])))
      .filter(Boolean) as ImportItem[]
    return {
      sourceKind: 'yandex', url: input, kind: 'playlist', title: pl.title ?? 'Плейлист',
      subtitle: pl.owner?.name, coverUrl: coverUrl(pl.cover?.uri ?? pl.ogImage) ?? items[0]?.coverUrl, items, notes
    }
  }

  // ───── скачивание оригинала (нужен токен) ─────

  /** Новый API: до FLAC (требует подписку Plus). Файл зашифрован AES-CTR. */
  private async fileInfo(trackId: string): Promise<{ url: string; codec: string; bitrate: number; key?: string }> {
    const ts = Math.floor(Date.now() / 1000)
    const quality = 'lossless'
    const codecs = ['flac', 'flac-mp4', 'mp3', 'aac', 'he-aac', 'aac-mp4', 'he-aac-mp4']
    const transports = 'encraw'
    const sign = createHmac('sha256', SIGN_KEY).update(`${ts}${trackId}${quality}${codecs.join('')}${transports}`).digest('base64').slice(0, -1)
    const qs = new URLSearchParams({ ts: String(ts), trackId, quality, codecs: codecs.join(','), transports, sign })
    const r = await this.call<any>(`/get-file-info?${qs}`)
    const d = r.downloadInfo
    if (!d?.url) throw new Error('Яндекс не вернул ссылку на файл')
    return { url: d.url, codec: String(d.codec), bitrate: Number(d.bitrate) || 0, key: d.key }
  }

  /** Старый API: mp3 до 320 kbps. */
  private async legacyInfo(trackId: string): Promise<{ url: string; codec: string; bitrate: number }> {
    const list = await this.call<any[]>(`/tracks/${trackId}/download-info`)
    const best = [...list].filter((x) => x.codec === 'mp3').sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0]
    if (!best) throw new Error('Нет доступных вариантов загрузки')
    const xml = await (await fetch(best.downloadInfoUrl, { headers: this.headers(), signal: AbortSignal.timeout(15000) })).text()
    const g = (tag: string) => xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1] ?? ''
    const host = g('host'), path = g('path'), ts = g('ts'), s = g('s')
    const sign = createHash('md5').update(MP3_SALT + path.slice(1) + s).digest('hex')
    return { url: `https://${host}/get-mp3/${sign}/${ts}${path}`, codec: 'mp3', bitrate: best.bitrateInKbps }
  }

  /** Скачивает оригинал в файл. Возвращает расширение и описание качества. */
  async download(trackId: string, destNoExt: string, onProgress: (p: number) => void, signal?: AbortSignal): Promise<{ file: string; detail: string }> {
    if (!this.token) throw new Error('Нет токена Яндекса')
    let info: { url: string; codec: string; bitrate: number; key?: string }
    try {
      info = await this.fileInfo(trackId)
    } catch (e) {
      console.warn('[yandex] get-file-info не сработал, пробую старый метод:', e)
      info = await this.legacyInfo(trackId)
    }
    const ext = info.codec.startsWith('flac') ? (info.codec === 'flac' ? 'flac' : 'm4a') : info.codec.includes('aac') ? 'm4a' : 'mp3'
    const file = `${destNoExt}.${ext}`
    const res = await fetch(info.url, { signal })
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать файл (HTTP ${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    let got = 0
    const progress = new Transform({
      transform(chunk, _enc, cb) {
        got += chunk.length
        if (total) onProgress((got / total) * 100)
        cb(null, chunk)
      }
    })
    const body = Readable.fromWeb(res.body as any)
    const out = createWriteStream(file)
    if (info.key) {
      const dec = createDecipheriv('aes-128-ctr', Buffer.from(info.key, 'hex'), Buffer.alloc(16))
      await pipeline(body, progress, dec, out)
    } else {
      await pipeline(body, progress, out)
    }
    return { file, detail: `Яндекс · ${info.codec.toUpperCase()}${info.bitrate ? ` ${info.bitrate} kbps` : ''}` }
  }

  /** Синхронизированный текст (LRC) от Яндекса, если есть. */
  async lyricsLrc(trackId: string): Promise<string | null> {
    if (!this.token) return null
    const ts = Math.floor(Date.now() / 1000)
    const sign = createHmac('sha256', SIGN_KEY).update(`${trackId}${ts}`).digest('base64')
    const qs = new URLSearchParams({ format: 'LRC', timeStamp: String(ts), sign })
    const r = await this.call<any>(`/tracks/${trackId}/lyrics?${qs}`)
    if (!r?.downloadUrl) return null
    const res = await fetch(r.downloadUrl, { headers: this.headers(), signal: AbortSignal.timeout(15000) })
    return res.ok ? res.text() : null
  }
}
