import type { ImportItem, ImportPreview, SourceKind } from '@shared/types'
import { cleanTitle, splitArtists } from '../../util'
import type { YtDlp } from '../ytdlp'

/** Определяет, нужна ли обработка как плейлиста. */
function wantsPlaylist(url: URL, kind: SourceKind): boolean {
  const p = url.pathname.replace(/\/+$/, '')
  if (kind === 'youtube') {
    if (p === '/playlist') return true
    if (p === '/browse' || p.startsWith('/channel/') || p.startsWith('/@') || p.startsWith('/c/')) return true
    if (url.searchParams.get('list') && !url.searchParams.get('v') && p !== '/watch') return true
    return false
  }
  if (kind === 'soundcloud') {
    const seg = p.split('/').filter(Boolean)
    if (seg.length === 1) return true // страница артиста
    if (seg[1] === 'sets' || seg[1] === 'tracks' || seg[1] === 'albums' || seg[1] === 'likes') return true
    return false
  }
  return false
}

export function parseEntry(e: any, kind: SourceKind): ImportItem | null {
  const id = String(e.id ?? '')
  const url: string = e.webpage_url || (e.url && /^https?:/.test(e.url) ? e.url : kind === 'youtube' && id ? `https://www.youtube.com/watch?v=${id}` : '')
  if (!url) return null

  let channel = String(e.channel || e.uploader || '').replace(/\s*-\s*Topic$/i, '').trim()
  // у «плоских» записей SoundCloud нет автора — берём имя профиля из ссылки
  if (!channel && kind === 'soundcloud') channel = /soundcloud\.com\/([^/?#]+)\//i.exec(url)?.[1] ?? ''
  let artists: string[] = []
  let title: string = e.track || e.title || ''

  if (typeof e.artist === 'string' && e.artist) artists = splitArtists(e.artist)
  else if (Array.isArray(e.artists) && e.artists.length) artists = e.artists.map(String)

  if (!artists.length) {
    // «Artist - Title»
    const t = cleanTitle(String(e.title ?? ''))
    const m = t.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/)
    if (m) {
      artists = splitArtists(m[1])
      title = m[2]
    } else {
      artists = channel ? [channel] : ['Unknown Artist']
      title = t
    }
  }
  title = cleanTitle(title)
  if (!title) title = 'Untitled'

  const thumbs: any[] = Array.isArray(e.thumbnails) ? e.thumbnails : []
  const best = thumbs.length ? thumbs[thumbs.length - 1]?.url : e.thumbnail
  const cover = kind === 'youtube' && id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : best

  return {
    key: `${kind}:${id || url}`,
    title,
    artists,
    album: e.album || undefined,
    year: e.release_year || undefined,
    duration: typeof e.duration === 'number' ? e.duration : undefined,
    coverUrl: cover,
    source: { kind, id: id || undefined, url },
    fetch: { type: 'url', url }
  }
}

export async function resolveViaYtDlp(rawUrl: string, kind: SourceKind, yt: YtDlp): Promise<ImportPreview> {
  const url = new URL(rawUrl)
  const playlist = wantsPlaylist(url, kind)
  const isLikes = kind === 'soundcloud' && url.pathname.replace(/\/+$/, '').endsWith('/likes')
  const end = isLikes ? 1000 : 300
  const j = await yt.info(rawUrl, { playlist, end })
  const notes: string[] = []

  if (Array.isArray(j.entries)) {
    // в лайках бывают чужие плейлисты — это не треки, их пропускаем
    const raw: any[] = isLikes ? j.entries.filter((e: any) => !/\/sets\//.test(String(e?.url ?? e?.webpage_url ?? ''))) : j.entries
    if (isLikes && raw.length < j.entries.length) notes.push(`Пропущено лайкнутых плейлистов: ${j.entries.length - raw.length}.`)
    const items = raw.map((e: any) => parseEntry(e, kind)).filter(Boolean) as ImportItem[]
    if (!items.length) throw new Error('В этом плейлисте не нашлось доступных треков.')
    if (j.entries.length >= end) notes.push(`Загружены первые ${end} треков.`)
    return {
      sourceKind: kind,
      url: rawUrl,
      kind: 'playlist',
      title: isLikes ? 'Лайки SoundCloud' : j.title || 'Плейлист',
      subtitle: j.uploader || j.channel || undefined,
      coverUrl: items[0]?.coverUrl,
      items,
      notes
    }
  }

  const item = parseEntry(j, kind)
  if (!item) throw new Error('Не удалось разобрать ссылку.')
  return {
    sourceKind: kind,
    url: rawUrl,
    kind: 'track',
    title: item.title,
    subtitle: item.artists.join(', '),
    coverUrl: item.coverUrl,
    items: [item],
    notes
  }
}

export interface ScProfile {
  user: string
  name: string
  url: string
  likesUrl: string
  playlists: { title: string; url: string }[]
}

/** «имя», «@имя» или ссылка на профиль → https://soundcloud.com/имя */
export function scProfileUrl(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) {
    let u: URL
    try {
      u = new URL(t)
    } catch {
      return null
    }
    if (!/(^|\.)soundcloud\.com$/i.test(u.hostname)) return null
    const seg = u.pathname.split('/').filter(Boolean)
    if (!seg.length) return null
    return `https://soundcloud.com/${seg[0]}`
  }
  const name = t.replace(/^@/, '')
  return /^[\w.-]{2,60}$/.test(name) ? `https://soundcloud.com/${name}` : null
}

/** Плейлисты («сеты») публичного профиля SoundCloud + адрес его лайков. */
export async function resolveScProfile(input: string, yt: YtDlp): Promise<ScProfile> {
  const base = scProfileUrl(input)
  if (!base) throw new Error('Не похоже на профиль SoundCloud. Вставьте ссылку вида soundcloud.com/имя или просто имя.')
  const user = base.split('/').pop() as string
  let j: any
  try {
    j = await yt.info(`${base}/sets`, { playlist: true, end: 200 })
  } catch (e) {
    throw new Error(`Не удалось открыть профиль «${user}». Он должен быть публичным. (${(e as Error).message})`)
  }
  const entries: any[] = Array.isArray(j?.entries) ? j.entries : []
  const playlists = entries
    .map((e) => ({ title: String(e.title || e.id || 'Плейлист'), url: String(e.url || e.webpage_url || '') }))
    .filter((p) => /^https:\/\/soundcloud\.com\//.test(p.url))
  return { user, name: String(j?.uploader || j?.title || user).replace(/\s*\(Sets\)\s*$/i, ''), url: base, likesUrl: `${base}/likes`, playlists }
}
