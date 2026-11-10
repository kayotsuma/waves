import type { ImportItem, ImportPreview } from '@shared/types'
import { fetchText, stripFeat } from '../../util'

const RE = /open\.spotify\.com\/(?:intl-[a-z]{2,3}(?:-[a-z]{2})?\/)?(track|album|playlist)\/([A-Za-z0-9]{22})/
const URI = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/

export function parseSpotify(input: string): { type: 'track' | 'album' | 'playlist'; id: string } | null {
  const m = input.match(RE) ?? input.match(URI)
  return m ? { type: m[1] as 'track' | 'album' | 'playlist', id: m[2] } : null
}

export function isSpotifyShortLink(input: string): boolean {
  return /^https?:\/\/spotify\.link\//.test(input)
}

/** spotify.link → открытая ссылка. */
export async function expandSpotifyLink(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) })
  return res.url
}

async function embedEntity(type: string, id: string): Promise<any> {
  const html = await fetchText(`https://open.spotify.com/embed/${type}/${id}`)
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('Spotify изменил формат страницы — не удалось прочитать данные.')
  const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity
  if (!entity) throw new Error('Spotify не вернул данных. Плейлист должен быть публичным.')
  return entity
}

function bestImage(entity: any): string | undefined {
  const imgs: any[] = entity?.visualIdentity?.image ?? []
  const sorted = [...imgs].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))
  return sorted[0]?.url ?? entity?.coverArt?.sources?.[0]?.url
}

function splitSubtitle(s: string | undefined): string[] {
  return (s ?? '')
    .split(/\s*,\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function searchQuery(artists: string[], title: string): string {
  return `${artists.slice(0, 2).join(' ')} ${stripFeat(title)}`.trim()
}

function toItem(raw: any, extra: { album?: string; coverUrl?: string; year?: number } = {}): ImportItem | null {
  const uri: string = raw.uri ?? ''
  const id = uri.split(':').pop() ?? raw.id
  const title: string = raw.title ?? raw.name
  if (!id || !title) return null
  const artists: string[] = Array.isArray(raw.artists) ? raw.artists.map((a: any) => a.name) : splitSubtitle(raw.subtitle)
  return {
    key: `spotify:${id}`,
    title,
    artists: artists.length ? artists : ['Unknown Artist'],
    album: extra.album,
    year: extra.year,
    duration: raw.duration ? raw.duration / 1000 : undefined,
    coverUrl: extra.coverUrl,
    source: { kind: 'spotify', id, url: `https://open.spotify.com/track/${id}` },
    fetch: { type: 'search', query: searchQuery(artists, title) }
  }
}

export async function resolveSpotify(input: string): Promise<ImportPreview> {
  let parsed = parseSpotify(input)
  if (!parsed && isSpotifyShortLink(input)) parsed = parseSpotify(await expandSpotifyLink(input))
  if (!parsed) throw new Error('Не удалось распознать ссылку Spotify.')

  const e = await embedEntity(parsed.type, parsed.id)
  const cover = bestImage(e)
  const notes: string[] = [
    'Spotify защищает аудио DRM, поэтому треки ищутся на YouTube Music по названию и длительности.'
  ]

  if (parsed.type === 'track') {
    const year = e.releaseDate?.isoString ? new Date(e.releaseDate.isoString).getUTCFullYear() : undefined
    const item = toItem(e, { coverUrl: cover, year })
    if (!item) throw new Error('Пустой ответ Spotify.')
    return {
      sourceKind: 'spotify',
      url: input,
      kind: 'track',
      title: item.title,
      subtitle: item.artists.join(', '),
      coverUrl: cover,
      items: [item],
      notes
    }
  }

  const list: any[] = e.trackList ?? []
  const isAlbum = parsed.type === 'album'
  const items = list
    .map((t) => toItem(t, isAlbum ? { album: e.title ?? e.name, coverUrl: cover } : {}))
    .filter(Boolean) as ImportItem[]
  if (!items.length) throw new Error('В списке нет треков (возможно, плейлист приватный).')
  if (items.length >= 100) notes.push('Spotify отдаёт без входа не более 100 треков — остальные нужно добавить отдельно.')

  return {
    sourceKind: 'spotify',
    url: input,
    kind: isAlbum ? 'album' : 'playlist',
    title: e.title ?? e.name ?? 'Spotify',
    subtitle: e.subtitle || undefined,
    coverUrl: cover,
    items,
    notes
  }
}

/** Обложка 640px, альбом и год конкретного трека (для элементов плейлиста). */
export async function spotifyTrackExtras(id: string): Promise<{ coverUrl?: string; album?: string; year?: number }> {
  const out: { coverUrl?: string; album?: string; year?: number } = {}
  try {
    const e = await embedEntity('track', id)
    out.coverUrl = bestImage(e)
    if (e.releaseDate?.isoString) out.year = new Date(e.releaseDate.isoString).getUTCFullYear()
  } catch {
    /* необязательно */
  }
  try {
    // og:description выглядит как «Artist · Album · Song · 2004»
    const html = await fetchText(`https://open.spotify.com/track/${id}`, { timeout: 10000 })
    const m = html.match(/property="og:description"\s+content="([^"]+)"/)
    if (m) {
      const parts = m[1].split(' · ').map((s) => s.trim())
      if (parts.length >= 3) out.album = parts[1]
    }
  } catch {
    /* необязательно */
  }
  return out
}
