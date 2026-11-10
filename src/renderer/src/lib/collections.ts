import type { Playlist, Track } from '@shared/types'

export interface Group {
  key: string
  title: string
  subtitle: string
  tracks: Track[]
}

const SEP = '\u0001'

export function normalizeQuery(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е')
}

export function filterTracks(tracks: Track[], query: string): Track[] {
  const q = normalizeQuery(query.trim())
  if (!q) return tracks
  const words = q.split(/\s+/)
  return tracks.filter((t) => {
    const hay = normalizeQuery(`${t.title} ${t.artist} ${t.album ?? ''}`)
    return words.every((w) => hay.includes(w))
  })
}

export function groupAlbums(tracks: Track[]): Group[] {
  const map = new Map<string, Group>()
  for (const t of tracks) {
    if (!t.album) continue
    const artist = t.artists[0] ?? t.artist
    const key = `${t.album}${SEP}${artist}`
    let g = map.get(key)
    if (!g) map.set(key, (g = { key, title: t.album, subtitle: artist, tracks: [] }))
    g.tracks.push(t)
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

export function groupArtists(tracks: Track[]): Group[] {
  const map = new Map<string, Group>()
  for (const t of tracks) {
    for (const a of t.artists.length ? t.artists : [t.artist]) {
      let g = map.get(a)
      if (!g) map.set(a, (g = { key: a, title: a, subtitle: '', tracks: [] }))
      g.tracks.push(t)
    }
  }
  for (const g of map.values()) g.subtitle = `${g.tracks.length}`
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

export function playlistTracks(p: Playlist, byId: Record<string, Track>): Track[] {
  return p.trackIds.map((id) => byId[id]).filter(Boolean)
}

export type SortKey = 'added' | 'title' | 'artist' | 'album' | 'duration' | 'plays'

export function sortTracks(tracks: Track[], key: SortKey): Track[] {
  const arr = [...tracks]
  const c = (a: string, b: string) => a.localeCompare(b, 'ru')
  switch (key) {
    case 'title':
      return arr.sort((a, b) => c(a.title, b.title))
    case 'artist':
      return arr.sort((a, b) => c(a.artist, b.artist) || c(a.album ?? '', b.album ?? ''))
    case 'album':
      return arr.sort((a, b) => c(a.album ?? '', b.album ?? '') || c(a.title, b.title))
    case 'duration':
      return arr.sort((a, b) => b.duration - a.duration)
    case 'plays':
      return arr.sort((a, b) => b.plays - a.plays)
    default:
      return arr.sort((a, b) => b.addedAt - a.addedAt)
  }
}
