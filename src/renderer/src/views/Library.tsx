import { useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Track } from '@shared/types'
import { Card } from '@/components/Cards'
import { TrackList } from '@/components/TrackList'
import { filterTracks, groupAlbums, groupArtists, playlistTracks, sortTracks, type SortKey } from '@/lib/collections'
import { tracksWord } from '@/lib/format'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUI } from '@/store/ui'
import { CollectionHeader, EmptyState } from './Common'

const SORTS: [SortKey, string][] = [
  ['added', 'Недавно добавленные'],
  ['title', 'Название'],
  ['artist', 'Исполнитель'],
  ['album', 'Альбом'],
  ['plays', 'Популярные'],
  ['duration', 'Длительность']
]

function AddCta() {
  const openImport = useUI((s) => s.openImport)
  return (
    <button className="btn primary" onClick={() => openImport()}>
      <Plus size={16} /> Добавить музыку
    </button>
  )
}

export function LibraryView({ tab = 'tracks' }: { tab?: 'tracks' | 'albums' | 'artists' }) {
  const tracks = useLibrary((s) => s.tracks)
  const query = useUI((s) => s.query)
  const navigate = useUI((s) => s.navigate)
  const [sort, setSort] = useState<SortKey>('added')
  const scrollRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => filterTracks(tracks, query), [tracks, query])
  const sorted = useMemo(() => sortTracks(filtered, sort), [filtered, sort])
  const albums = useMemo(() => groupAlbums(filtered), [filtered])
  const artists = useMemo(() => groupArtists(filtered), [filtered])

  return (
    <div className="view scroll" ref={scrollRef}>
      <div className="view-head">
        <h1>Медиатека</h1>
        <div className="tabs">
          {(['tracks', 'albums', 'artists'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => navigate({ name: 'library', tab: t })}>
              {t === 'tracks' ? 'Треки' : t === 'albums' ? 'Альбомы' : 'Исполнители'}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {tab === 'tracks' && (
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Сортировка">
            {SORTS.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        )}
      </div>

      {tracks.length === 0 ? (
        <EmptyState title="Здесь пока пусто" text="Вставьте ссылку на трек или плейлист из YouTube, SoundCloud, Spotify, Apple Music, Deezer или Яндекс Музыки." action={<AddCta />} />
      ) : filtered.length === 0 ? (
        <EmptyState title="Ничего не найдено" text={`По запросу «${query}» в библиотеке ничего нет.`} />
      ) : tab === 'tracks' ? (
        <>
          <p className="muted count">{query ? `Найдено: ${tracksWord(filtered.length)}` : tracksWord(filtered.length)}</p>
          <TrackList tracks={sorted} scrollRef={scrollRef} />
        </>
      ) : (
        <div className="grid">
          {(tab === 'albums' ? albums : artists).map((g) => (
            <Card
              key={g.key}
              tracks={g.tracks}
              title={g.title}
              round={tab === 'artists'}
              subtitle={tab === 'albums' ? g.subtitle : tracksWord(g.tracks.length)}
              onOpen={() => navigate(tab === 'albums' ? { name: 'album', key: g.key } : { name: 'artist', key: g.key })}
              onPlay={() => usePlayer.getState().playTracks(g.tracks.map((t) => t.id))}
            />
          ))}
          {(tab === 'albums' ? albums : artists).length === 0 && <p className="muted">Нет данных.</p>}
        </div>
      )}
    </div>
  )
}

export function LikedView() {
  const tracks = useLibrary((s) => s.tracks)
  const scrollRef = useRef<HTMLDivElement>(null)
  const liked = useMemo(() => sortTracks(tracks.filter((t) => t.liked), 'added'), [tracks])
  return (
    <div className="view scroll" ref={scrollRef}>
      <CollectionHeader kind="Плейлист" title="Любимое" tracks={liked} liked />
      {liked.length === 0 ? <EmptyState title="Нет любимых треков" text="Нажмите на сердечко рядом с треком, чтобы он появился здесь." /> : <TrackList tracks={liked} scrollRef={scrollRef} />}
    </div>
  )
}

export function GroupView({ type, groupKey }: { type: 'album' | 'artist'; groupKey: string }) {
  const tracks = useLibrary((s) => s.tracks)
  const scrollRef = useRef<HTMLDivElement>(null)
  const group = useMemo(() => (type === 'album' ? groupAlbums(tracks) : groupArtists(tracks)).find((g) => g.key === groupKey), [tracks, type, groupKey])
  if (!group) return <EmptyState title="Не найдено" text="Возможно, треки были удалены." />
  const list: Track[] = type === 'album' ? [...group.tracks].sort((a, b) => a.addedAt - b.addedAt) : sortTracks(group.tracks, 'album')
  return (
    <div className="view scroll" ref={scrollRef}>
      <CollectionHeader kind={type === 'album' ? 'Альбом' : 'Исполнитель'} title={group.title} tracks={list} round={type === 'artist'} />
      <TrackList tracks={list} scrollRef={scrollRef} showAlbum={type === 'artist'} />
    </div>
  )
}

export function PlaylistView({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id))
  const byId = useLibrary((s) => s.byId)
  const openModal = useUI((s) => s.openModal)
  const navigate = useUI((s) => s.navigate)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tracks = useMemo(() => (playlist ? playlistTracks(playlist, byId) : []), [playlist, byId])
  if (!playlist) return <EmptyState title="Плейлист не найден" text="Он мог быть удалён." />
  return (
    <div className="view scroll" ref={scrollRef}>
      <CollectionHeader
        kind="Плейлист"
        title={playlist.name}
        tracks={tracks}
        actions={
          <>
            <button className="btn lg" onClick={() => openModal({ kind: 'rename-playlist', id, name: playlist.name })}>Переименовать</button>
            <button
              className="btn lg danger-text"
              onClick={() =>
                openModal({
                  kind: 'confirm',
                  title: 'Удалить плейлист?',
                  text: `Плейлист «${playlist.name}» будет удалён. Сами треки останутся в библиотеке.`,
                  confirmLabel: 'Удалить',
                  danger: true,
                  onConfirm: () => {
                    void window.wave.library.deletePlaylist(id)
                    navigate({ name: 'library', tab: 'tracks' })
                  }
                })
              }
            >
              Удалить
            </button>
          </>
        }
      />
      {tracks.length === 0 ? (
        <EmptyState title="Плейлист пуст" text="Добавляйте треки через контекстное меню (правая кнопка мыши) → «Добавить в плейлист»." />
      ) : (
        <TrackList tracks={tracks} scrollRef={scrollRef} playlistId={id} />
      )}
    </div>
  )
}
