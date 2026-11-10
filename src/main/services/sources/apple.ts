import type { ImportItem, ImportPreview } from '@shared/types'
import { fetchJson, fetchText, splitArtists, stripFeat } from '../../util'

/**
 * Apple Music: ссылка на трек, альбом или публичный плейлист, без ключей.
 * Альбомы и треки — через открытый iTunes Lookup API, плейлисты — из данных веб-страницы.
 * Звук Apple Music защищён DRM, поэтому, как и у Spotify, треки ищутся на YouTube Music.
 */

export interface AppleRef {
  type: 'song' | 'album' | 'playlist'
  id: string
  country: string
}

export function isAppleMusicUrl(input: string): boolean {
  try {
    const h = new URL(input).hostname.replace(/^(www|embed|geo|classical)\./, '')
    return h === 'music.apple.com' || h === 'itunes.apple.com'
  } catch {
    return false
  }
}

export function parseApple(input: string): AppleRef | null {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }
  const parts = u.pathname.split('/').filter(Boolean)
  const country = /^[a-z]{2}$/i.test(parts[0] ?? '') ? parts.shift()!.toLowerCase() : 'us'
  const kind = parts[0]
  const last = parts[parts.length - 1] ?? ''
  if (kind === 'playlist' && /^pl\./.test(last)) return { type: 'playlist', id: last, country }
  const song = u.searchParams.get('i')
  if (kind === 'album' && song && /^\d+$/.test(song)) return { type: 'song', id: song, country }
  if (kind === 'album' && /^\d+$/.test(last)) return { type: 'album', id: last, country }
  if (kind === 'song' && /^\d+$/.test(last)) return { type: 'song', id: last, country }
  return null
}

const bigArt = (url: string | undefined): string | undefined => url?.replace(/\/\d+x\d+(bb|cc|SC)?[^/]*$/, '/1000x1000bb.jpg')

const searchQuery = (artists: string[], title: string) => `${artists.slice(0, 2).join(' ')} ${stripFeat(title)}`.trim()

function item(p: { id: string; title: string; artists: string[]; album?: string; year?: number; duration?: number; cover?: string; url?: string }): ImportItem {
  return {
    key: `apple:${p.id}`,
    title: p.title,
    artists: p.artists.length ? p.artists : ['Unknown Artist'],
    album: p.album,
    year: p.year,
    duration: p.duration,
    coverUrl: p.cover,
    source: { kind: 'apple', id: p.id, url: p.url },
    fetch: { type: 'search', query: searchQuery(p.artists, p.title) }
  }
}

const NOTE = 'Apple Music защищает аудио DRM, поэтому треки ищутся на YouTube Music по названию и длительности.'

async function lookup(ref: AppleRef): Promise<ImportPreview> {
  const url = `https://itunes.apple.com/lookup?id=${ref.id}&entity=song&country=${ref.country}`
  const data = await fetchJson<{ results: any[] }>(url)
  const results = data.results ?? []
  const head = results.find((r) => r.wrapperType === 'collection' || r.wrapperType === 'artist') ?? null
  const songs = results.filter((r) => r.wrapperType === 'track' && r.kind === 'song')
  if (!songs.length && ref.type === 'song') throw new Error('Apple Music не нашёл этот трек (возможно, он недоступен в регионе из ссылки).')
  if (!songs.length) throw new Error('Альбом пуст или недоступен.')

  const items = songs
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
    .map((r) =>
      item({
        id: String(r.trackId),
        title: r.trackName,
        artists: splitArtists(r.artistName ?? ''),
        album: r.collectionName,
        year: r.releaseDate ? new Date(r.releaseDate).getUTCFullYear() : undefined,
        duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : undefined,
        cover: bigArt(r.artworkUrl100),
        url: r.trackViewUrl
      })
    )
  const first = items[0]
  if (ref.type === 'song') {
    return { sourceKind: 'apple', url: '', kind: 'track', title: first.title, subtitle: first.artists.join(', '), coverUrl: first.coverUrl, items: [first], notes: [NOTE] }
  }
  return {
    sourceKind: 'apple',
    url: '',
    kind: 'album',
    title: head?.collectionName ?? first.album ?? 'Альбом',
    subtitle: head?.artistName,
    coverUrl: first.coverUrl,
    items,
    notes: [NOTE]
  }
}

function unescapeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function metaContent(html: string, prop: string): string | undefined {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'))
  return m ? unescapeHtml(m[1]) : undefined
}

function findLockups(root: unknown): any[] {
  const out: any[] = []
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return
    if (typeof o.id === 'string' && o.id.startsWith('track-lockup') && typeof o.title === 'string') {
      out.push(o)
      return
    }
    for (const k in o) walk(o[k])
  }
  walk(root)
  return out
}

function artworkUrl(art: any): string | undefined {
  const tpl: string | undefined = art?.dictionary?.url ?? art?.url
  return tpl?.replace('{w}', '1000').replace('{h}', '1000').replace('{c}', 'bb').replace('{f}', 'jpg')
}

async function playlist(ref: AppleRef, original: string): Promise<ImportPreview> {
  const html = await fetchText(`https://music.apple.com/${ref.country}/playlist/${ref.id}`, { timeout: 25000 })
  const sd = html.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/)
  const items: ImportItem[] = []
  const seen = new Set<string>()
  if (sd) {
    try {
      for (const t of findLockups(JSON.parse(sd[1]))) {
        const cd = t.contentDescriptor
        const id: string | undefined = cd?.identifiers?.storeAdamID ?? String(t.id).split(' - ').pop()
        if (!id || seen.has(id) || (cd?.kind && cd.kind !== 'song')) continue
        seen.add(id)
        const album: string | undefined = (t.tertiaryLinks?.[0]?.title as string | undefined)?.replace(/\s+-\s+(Single|EP)$/i, '')
        items.push(
          item({
            id,
            title: t.title,
            artists: splitArtists(t.artistName ?? ''),
            album,
            duration: typeof t.duration === 'number' ? t.duration / 1000 : undefined,
            cover: artworkUrl(t.artwork),
            url: cd?.url
          })
        )
      }
    } catch {
      /* разберём JSON-LD */
    }
  }
  const ld = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)
  let ldJson: any = null
  try {
    ldJson = ld ? JSON.parse(ld[1]) : null
  } catch {
    /* ignore */
  }
  if (!items.length && ldJson?.track) {
    // запасной путь: в JSON-LD нет исполнителя, поэтому он берётся из названия страницы → хуже, но лучше, чем ничего
    for (const t of ldJson.track as any[]) {
      const id = String(t.url ?? '').split('/').pop() ?? ''
      if (!id || seen.has(id) || !t.name) continue
      seen.add(id)
      const m = /^PT(?:(\d+)M)?(?:(\d+)S)?$/.exec(t.duration ?? '')
      items.push(item({ id, title: t.name, artists: [], duration: m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : undefined, url: t.url }))
    }
  }
  if (!items.length) throw new Error('Не удалось прочитать плейлист Apple Music. Он должен быть публичным.')

  const total: number | undefined = ldJson?.numTracks
  const notes = [NOTE]
  if (total && total > items.length) notes.push(`Apple Music отдаёт без входа первые ${items.length} из ${total} треков — остальные нужно добавить отдельно.`)
  const title = ldJson?.name ?? metaContent(html, 'og:title')?.replace(/\s+on Apple Music$/i, '') ?? 'Плейлист Apple Music'
  return {
    sourceKind: 'apple',
    url: original,
    kind: 'playlist',
    title,
    subtitle: ldJson?.author?.name,
    coverUrl: items[0]?.coverUrl,
    items,
    notes
  }
}

export async function resolveApple(input: string): Promise<ImportPreview> {
  const ref = parseApple(input)
  if (!ref) throw new Error('Не удалось распознать ссылку Apple Music: нужна ссылка на трек, альбом или публичный плейлист.')
  const p = ref.type === 'playlist' ? await playlist(ref, input) : await lookup(ref)
  p.url = input
  return p
}
