import type { ImportItem, ImportPreview } from '@shared/types'
import { fetchJson, stripFeat, UA } from '../../util'

// Импорт из Deezer: трек, альбом, публичный плейлист — через открытый API api.deezer.com (без ключей).
// Идея и порядок обхода страниц плейлиста взяты из Riff (rootscripts/riff, MIT) — см. THIRD_PARTY_NOTICES.md.
// Звук Deezer защищён DRM, поэтому, как и у Spotify/Apple Music, треки ищутся на YouTube Music.

export interface DeezerRef {
  type: 'track' | 'album' | 'playlist'
  id: string
}

const HOSTS = /^(?:www\.)?deezer\.com$|^link\.deezer\.com$|^deezer\.page\.link$/

export function isDeezerUrl(input: string): boolean {
  try {
    return HOSTS.test(new URL(input).hostname)
  } catch {
    return false
  }
}

export function parseDeezer(input: string): DeezerRef | null {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }
  // https://www.deezer.com/ru/playlist/123456
  const m = u.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist)\/(\d+)\/?$/i)
  return m ? { type: m[1].toLowerCase() as DeezerRef['type'], id: m[2] } : null
}

const NOTE = 'Deezer защищает аудио DRM, поэтому треки ищутся на YouTube Music по названию и длительности.'

const api = <T = any>(path: string) => fetchJson<T>(path.startsWith('http') ? path : `https://api.deezer.com/${path}`, { timeout: 20000 })

function item(t: any, fallbackCover?: string, album?: any): ImportItem | null {
  if (!t?.id || !t.title || !t.artist?.name) return null
  const artists = [t.artist.name, ...((t.contributors ?? []) as any[]).map((c) => c?.name).filter((n) => n && n !== t.artist.name)]
  const alb = t.album ?? album
  return {
    key: `deezer:${t.id}`,
    title: String(t.title),
    artists,
    album: alb?.title,
    duration: Number(t.duration) || undefined,
    coverUrl: alb?.cover_xl ?? alb?.cover_big ?? alb?.cover ?? fallbackCover,
    source: { kind: 'deezer', id: String(t.id), url: t.link },
    fetch: { type: 'search', query: `${artists.slice(0, 2).join(' ')} ${stripFeat(String(t.title))}`.trim() }
  }
}

/** Все страницы списка (у Deezer ответ постраничный: поле `next`). Ссылки `next` обязаны вести на api.deezer.com. */
async function allPages(first: { data?: any[]; next?: string } | undefined, maxPages = 100): Promise<any[]> {
  const out: any[] = [...(first?.data ?? [])]
  let next = first?.next
  for (let i = 0; next && i < maxPages; i++) {
    if (new URL(next).hostname !== 'api.deezer.com') break
    const page = await api<{ data?: any[]; next?: string }>(next)
    out.push(...(page.data ?? []))
    next = page.next
  }
  return out
}

/** Короткие ссылки (link.deezer.com, deezer.page.link) разворачиваем редиректом. */
async function expand(input: string): Promise<string> {
  if (!/^(?:link\.deezer\.com|deezer\.page\.link)$/.test(new URL(input).hostname)) return input
  const res = await fetch(input, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) })
  return res.url || input
}

export async function resolveDeezer(input: string): Promise<ImportPreview> {
  const ref = parseDeezer(await expand(input))
  if (!ref) throw new Error('Не понял ссылку Deezer: поддерживаются трек, альбом и публичный плейлист.')

  if (ref.type === 'track') {
    const t = await api(`track/${ref.id}`)
    if (t?.error) throw new Error('Deezer не нашёл этот трек.')
    const it = item(t)
    if (!it) throw new Error('Не удалось прочитать трек Deezer.')
    return { sourceKind: 'deezer', url: input, kind: 'track', title: it.title, subtitle: it.artists.join(', '), coverUrl: it.coverUrl, items: [it], notes: [NOTE] }
  }

  if (ref.type === 'album') {
    const a = await api(`album/${ref.id}`)
    if (a?.error || !a?.id) throw new Error('Deezer не нашёл этот альбом.')
    const cover = a.cover_xl ?? a.cover_big ?? a.cover
    const tracks = await allPages(a.tracks)
    const items = tracks
      // у треков внутри альбома нет поля album — подставляем сам альбом
      .map((t) => item({ ...t, artist: t.artist ?? a.artist }, cover, a))
      .filter(Boolean) as ImportItem[]
    if (!items.length) throw new Error('Альбом пуст или недоступен.')
    for (const it of items) it.year = a.release_date ? Number(String(a.release_date).slice(0, 4)) || undefined : undefined
    return { sourceKind: 'deezer', url: input, kind: 'album', title: a.title, subtitle: a.artist?.name, coverUrl: cover, items, notes: [NOTE] }
  }

  const p = await api(`playlist/${ref.id}`)
  if (p?.error || !p?.id) throw new Error('Deezer не нашёл этот плейлист (он может быть приватным).')
  const tracks = await allPages(p.tracks)
  const items = tracks.map((t) => item(t)).filter(Boolean) as ImportItem[]
  if (!items.length) throw new Error('В этом плейлисте Deezer нет треков.')
  return {
    sourceKind: 'deezer',
    url: input,
    kind: 'playlist',
    title: p.title || 'Плейлист Deezer',
    subtitle: [p.creator?.name, `${items.length} треков`].filter(Boolean).join(' · '),
    coverUrl: p.picture_xl ?? p.picture_big ?? p.picture,
    items,
    notes: [NOTE]
  }
}
