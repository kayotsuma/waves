import { useMemo, useRef, useState } from 'react'
import { Play, SearchX } from 'lucide-react'
import { Card, Mosaic } from '@/components/Cards'
import { TrackList } from '@/components/TrackList'
import { filterTracks, groupAlbums, groupArtists, normalizeQuery, playlistTracks } from '@/lib/collections'
import { tracksWord } from '@/lib/format'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUI } from '@/store/ui'
import { EmptyState } from './Common'

type Kind = 'all' | 'songs' | 'artists' | 'albums' | 'playlists'
const CHIPS: [Kind, string][] = [['all', 'Всё'], ['songs', 'Треки'], ['artists', 'Исполнители'], ['albums', 'Альбомы'], ['playlists', 'Плейлисты']]

/** Результаты поиска по библиотеке с разделами и лучшим совпадением. */
export function SearchView() {
  const query = useUI((s) => s.query)
  const navigate = useUI((s) => s.navigate)
  const tracks = useLibrary((s) => s.tracks)
  const playlists = useLibrary((s) => s.playlists)
  const byId = useLibrary((s) => s.byId)
  const [kind, setKind] = useState<Kind>('all')
  const scrollRef = useRef<HTMLDivElement>(null)
  const q = normalizeQuery(query.trim())

  const songs = useMemo(() => filterTracks(tracks, query), [tracks, query])
  const artists = useMemo(() => groupArtists(tracks).filter((g) => normalizeQuery(g.title).includes(q)), [tracks, q])
  const albums = useMemo(() => groupAlbums(tracks).filter((g) => normalizeQuery(`${g.title} ${g.subtitle}`).includes(q)), [tracks, q])
  const lists = useMemo(() => playlists.filter((p) => normalizeQuery(p.name).includes(q)), [playlists, q])

  const top = useMemo(() => {
    const exactArtist = artists.find((a) => normalizeQuery(a.title).startsWith(q))
    if (exactArtist) return { type: 'artist' as const, title: exactArtist.title, sub: `Исполнитель · ${tracksWord(exactArtist.tracks.length)}`, tracks: exactArtist.tracks, open: () => navigate({ name: 'artist', key: exactArtist.key }) }
    if (songs[0]) return { type: 'song' as const, title: songs[0].title, sub: `Трек · ${songs[0].artist}`, tracks: [songs[0]], open: () => usePlayer.getState().playTracks([songs[0].id]) }
    return null
  }, [artists, songs, q, navigate])

  if (!q) return <EmptyState title="Поиск по библиотеке" text="Введите название трека, исполнителя, альбома или плейлиста." />
  const nothing = !songs.length && !artists.length && !albums.length && !lists.length
  const show = (k: Kind) => kind === 'all' || kind === k

  return (
    <div className="view scroll" ref={scrollRef}>
      <div className="chips">
        {CHIPS.map(([k, l]) => (
          <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      {nothing ? (
        <EmptyState title="Ничего не найдено" text={`По запросу «${query}» в библиотеке пусто. Попробуйте другое написание — или добавьте музыку по ссылке.`} action={<SearchX size={28} />} />
      ) : (
        <>
          {kind === 'all' && top && (
            <section className="shelf">
              <h2>Лучшее совпадение</h2>
              <div className="top-result" onClick={top.open} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && top.open()}>
                <span className={`top-art ${top.type === 'artist' ? 'round' : ''}`}><Mosaic tracks={top.tracks} size={96} radius={top.type === 'artist' ? '50%' : 16} /></span>
                <span className="top-txt"><b>{top.title}</b><small>{top.sub}</small></span>
                <button className="top-play" onClick={(e) => { e.stopPropagation(); usePlayer.getState().playTracks(top.tracks.map((t) => t.id)) }} aria-label="Играть"><Play size={22} fill="currentColor" /></button>
              </div>
            </section>
          )}
          {show('playlists') && lists.length > 0 && (
            <section className="shelf">
              <h2>Плейлисты</h2>
              <div className="row-scroll">
                {lists.map((p) => {
                  const list = playlistTracks(p, byId)
                  return <Card key={p.id} tracks={list} title={p.name} subtitle={`Плейлист · ${tracksWord(list.length)}`} onOpen={() => navigate({ name: 'playlist', id: p.id })} onPlay={() => usePlayer.getState().playTracks(list.map((t) => t.id))} />
                })}
              </div>
            </section>
          )}
          {show('artists') && artists.length > 0 && (
            <section className="shelf">
              <h2>Исполнители</h2>
              <div className="row-scroll">
                {artists.slice(0, 24).map((a) => (
                  <Card key={a.key} round tracks={a.tracks} title={a.title} subtitle={`Исполнитель · ${tracksWord(a.tracks.length)}`} onOpen={() => navigate({ name: 'artist', key: a.key })} onPlay={() => usePlayer.getState().playTracks(a.tracks.map((t) => t.id))} />
                ))}
              </div>
            </section>
          )}
          {show('albums') && albums.length > 0 && (
            <section className="shelf">
              <h2>Альбомы</h2>
              <div className="row-scroll">
                {albums.slice(0, 24).map((a) => (
                  <Card key={a.key} tracks={a.tracks} title={a.title} subtitle={a.subtitle} onOpen={() => navigate({ name: 'album', key: a.key })} onPlay={() => usePlayer.getState().playTracks(a.tracks.map((t) => t.id))} />
                ))}
              </div>
            </section>
          )}
          {show('songs') && songs.length > 0 && (
            <section className="shelf">
              <h2>Треки</h2>
              <TrackList tracks={songs} scrollRef={scrollRef} />
            </section>
          )}
        </>
      )}
    </div>
  )
}
