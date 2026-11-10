import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { LibrarySnapshot, Playlist, SourceKind, Track, TrackPatch } from '@shared/types'
import { coversDir, dataDir, lyricsDir } from './paths'
import { JsonStore } from './store'

interface LibraryFile {
  version: 1
  tracks: Track[]
  playlists: Playlist[]
}

export class LibraryService {
  private store: JsonStore<LibraryFile>
  private tracks = new Map<string, Track>()
  onTrack: (kind: 'upsert' | 'remove', track: Track) => void = () => {}
  onPlaylists: (playlists: Playlist[]) => void = () => {}
  /** трек удалён пользователем / плейлист удалён — для tombstone'ов синхронизации */
  onRemoved: (tracks: Track[]) => void = () => {}
  onPlaylistDeleted: (id: string) => void = () => {}

  constructor() {
    this.store = new JsonStore<LibraryFile>(
      join(dataDir(), 'library.json'),
      { version: 1, tracks: [], playlists: [] },
      (l, d) => ({ ...d, ...(l as Partial<LibraryFile>) })
    )
    for (const t of this.store.data.tracks) this.tracks.set(t.id, t)
    this.checkFiles()
  }

  /** Помечает треки, файлы которых пропали с диска. */
  checkFiles(): void {
    for (const t of this.tracks.values()) t.missing = !t.remote && !existsSync(t.file)
  }

  snapshot(): LibrarySnapshot {
    return { tracks: [...this.tracks.values()], playlists: this.store.data.playlists }
  }

  get(id: string): Track | undefined {
    return this.tracks.get(id)
  }

  findBySource(kind: SourceKind, id: string): Track | undefined {
    for (const t of this.tracks.values()) if (t.source.kind === kind && t.source.id === id) return t
    return undefined
  }

  findByFile(file: string): Track | undefined {
    for (const t of this.tracks.values()) if (t.file === file) return t
    return undefined
  }

  /** Трек, извлечённый из видео по пути исходного видеофайла. */
  findBySourceUrl(url: string): Track | undefined {
    for (const t of this.tracks.values()) if (t.source.kind === 'local' && t.source.url === url) return t
    return undefined
  }

  private persist(): void {
    this.store.data.tracks = [...this.tracks.values()].map(({ missing: _m, ...rest }) => rest as Track)
    this.store.save()
  }

  add(input: Omit<Track, 'id' | 'addedAt' | 'plays' | 'liked' | 'coverRev'> & Partial<Track>): Track {
    const track: Track = {
      plays: 0,
      liked: false,
      coverRev: 1,
      ...input,
      id: input.id ?? randomUUID(),
      addedAt: Date.now()
    }
    this.tracks.set(track.id, track)
    this.persist()
    this.onTrack('upsert', track)
    return track
  }

  update(id: string, patch: Partial<Track>): Track | undefined {
    const t = this.tracks.get(id)
    if (!t) return undefined
    Object.assign(t, patch)
    this.persist()
    this.onTrack('upsert', t)
    return t
  }

  edit(id: string, patch: TrackPatch): Track | undefined {
    const clean: Partial<Track> = {}
    if (typeof patch.title === 'string' && patch.title.trim()) clean.title = patch.title.trim()
    if (typeof patch.artist === 'string' && patch.artist.trim()) {
      clean.artist = patch.artist.trim()
      clean.artists = patch.artist.split(/\s*,\s*/).filter(Boolean)
    }
    if (typeof patch.album === 'string') clean.album = patch.album.trim() || undefined
    if (typeof patch.year === 'number') clean.year = patch.year || undefined
    return this.update(id, clean)
  }

  remove(ids: string[], deleteFiles: boolean): void {
    const removed: Track[] = []
    for (const id of ids) {
      const t = this.tracks.get(id)
      if (!t) continue
      this.tracks.delete(id)
      removed.push(t)
      if (deleteFiles && !t.remote && t.source.kind !== 'local') rmSync(t.file, { force: true })
      rmSync(join(coversDir(), `${id}.jpg`), { force: true })
      rmSync(join(lyricsDir(), `${id}.json`), { force: true })
    }
    for (const p of this.store.data.playlists) p.trackIds = p.trackIds.filter((x) => !ids.includes(x))
    this.persist()
    removed.forEach((t) => this.onTrack('remove', t))
    this.onPlaylists(this.store.data.playlists)
    if (removed.length) this.onRemoved(removed)
  }

  toggleLike(id: string): Track | undefined {
    const t = this.tracks.get(id)
    return t ? this.update(id, { liked: !t.liked, likedAt: Date.now() }) : undefined
  }

  recordPlay(id: string): void {
    const t = this.tracks.get(id)
    if (t) this.update(id, { plays: t.plays + 1, lastPlayedAt: Date.now() })
  }

  // ───── плейлисты ─────

  createPlaylist(name: string, trackIds: string[] = []): Playlist {
    const now = Date.now()
    const p: Playlist = {
      id: randomUUID(),
      name: name.trim() || 'Новый плейлист',
      trackIds: trackIds.filter((id) => this.tracks.has(id)),
      createdAt: now,
      updatedAt: now
    }
    this.store.data.playlists.push(p)
    this.store.save()
    this.onPlaylists(this.store.data.playlists)
    return p
  }

  renamePlaylist(id: string, name: string): void {
    const p = this.store.data.playlists.find((x) => x.id === id)
    if (!p || !name.trim()) return
    p.name = name.trim()
    p.updatedAt = Date.now()
    this.store.save()
    this.onPlaylists(this.store.data.playlists)
  }

  deletePlaylist(id: string): void {
    this.store.data.playlists = this.store.data.playlists.filter((x) => x.id !== id)
    this.store.save()
    this.onPlaylists(this.store.data.playlists)
    this.onPlaylistDeleted(id)
  }

  // ───── для синхронизации (не трогают updatedAt и не создают tombstone'ов) ─────

  get playlists(): Playlist[] {
    return this.store.data.playlists
  }

  allTracks(): Track[] {
    return [...this.tracks.values()]
  }

  upsertPlaylistRaw(p: Playlist): void {
    const list = this.store.data.playlists
    const i = list.findIndex((x) => x.id === p.id)
    if (i >= 0) list[i] = p
    else list.push(p)
    this.store.save()
    this.onPlaylists(list)
  }

  dropPlaylistRaw(id: string): void {
    this.store.data.playlists = this.store.data.playlists.filter((x) => x.id !== id)
    this.store.save()
    this.onPlaylists(this.store.data.playlists)
  }

  addToPlaylist(id: string, trackIds: string[]): void {
    const p = this.store.data.playlists.find((x) => x.id === id)
    if (!p) return
    for (const tid of trackIds) if (this.tracks.has(tid) && !p.trackIds.includes(tid)) p.trackIds.push(tid)
    p.updatedAt = Date.now()
    this.store.save()
    this.onPlaylists(this.store.data.playlists)
  }

  removeFromPlaylist(id: string, trackIds: string[]): void {
    const p = this.store.data.playlists.find((x) => x.id === id)
    if (!p) return
    p.trackIds = p.trackIds.filter((t) => !trackIds.includes(t))
    p.updatedAt = Date.now()
    this.store.save()
    this.onPlaylists(this.store.data.playlists)
  }

  reorderPlaylist(id: string, trackIds: string[]): void {
    const p = this.store.data.playlists.find((x) => x.id === id)
    if (!p) return
    p.trackIds = trackIds.filter((t) => this.tracks.has(t))
    p.updatedAt = Date.now()
    this.store.save()
    this.onPlaylists(this.store.data.playlists)
  }

  flush(): void {
    this.store.flush()
  }
}
