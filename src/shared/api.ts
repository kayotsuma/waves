import type {
  AppInfo,
  BinariesStatus,
  DeepPartial,
  DownloadJob,
  ImportItem,
  ImportPreview,
  LibrarySnapshot,
  LyricLine,
  LyricsData,
  PluginInfo,
  PresenceInfo,
  PresenceStatus,
  SimilarTrack,
  TrackAnalysis,
  Playlist,
  Settings,
  SyncStatus,
  Track,
  TrackPatch, AlignStatus, ListenInfo, ListenYear, Profile, ProfileListItem, PublicProfile, ShowcaseData } from './types'

export interface PublishState {
  published: boolean
  at?: number
  error?: string
}

export interface WaveApi {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    showInFolder(path: string): Promise<void>
    pickFolder(): Promise<string | null>
    pickAudio(): Promise<string[]>
    pickImage(): Promise<string | null>
    pickBackground(): Promise<string | null>
    setTitleOverlay(color: string, symbolColor: string): Promise<void>
    pathForFile(file: File): string
    /** снимок прямоугольника окна (в пикселях CSS) → PNG через диалог сохранения; путь или null */
    saveCapture(rect: { x: number; y: number; width: number; height: number }, name: string): Promise<string | null>
  }
  listens: {
    /** пульс плеера: сессия, трек, начало прослушивания (мс), сколько секунд звучало */
    tick(session: string, trackId: string, startedAt: number, seconds: number): Promise<void>
    info(): Promise<ListenInfo>
    year(year: number): Promise<ListenYear>
  }
  profile: {
    get(): Promise<Profile>
    set(p: Profile): Promise<Profile>
    /** выбрать картинку и получить её как data:-URL (большие уменьшаются, GIF остаётся анимированным) */
    pickImage(kind: 'avatar' | 'banner'): Promise<string | null>
    publish(data: ShowcaseData): Promise<PublishState>
    publishState(): Promise<PublishState>
    list(): Promise<ProfileListItem[]>
    fetch(username: string): Promise<PublicProfile>
  }
  settings: {
    get(): Promise<Settings>
    patch(p: DeepPartial<Settings>): Promise<Settings>
    setBackgroundImage(path: string | null): Promise<string | null>
  }
  library: {
    snapshot(): Promise<LibrarySnapshot>
    edit(id: string, patch: TrackPatch): Promise<void>
    remove(ids: string[], deleteFiles: boolean): Promise<void>
    like(id: string): Promise<void>
    setDuration(id: string, seconds: number): Promise<void>
    played(id: string): Promise<void>
    importLocal(paths: string[]): Promise<number>
    /** вырезать фрагмент [start, end] с, без перекодирования, и добавить как новый трек */
    trim(id: string, start: number, end: number): Promise<Track>
    replaceCover(id: string, imagePath: string): Promise<boolean>
    createPlaylist(name: string, trackIds?: string[]): Promise<Playlist>
    renamePlaylist(id: string, name: string): Promise<void>
    deletePlaylist(id: string): Promise<void>
    addToPlaylist(id: string, trackIds: string[]): Promise<void>
    removeFromPlaylist(id: string, trackIds: string[]): Promise<void>
    reorderPlaylist(id: string, trackIds: string[]): Promise<void>
  }
  imports: {
    resolve(input: string): Promise<ImportPreview>
    start(items: ImportItem[], opts?: { playlistName?: string; playlistId?: string; like?: boolean; stream?: boolean }): Promise<number>
    scProfile(input: string): Promise<{ user: string; name: string; url: string; likesUrl: string; playlists: { title: string; url: string }[] }>
  }
  stream: {
    info(id: string): Promise<{ kind: 'file' | 'hls'; url: string }>
  }
  downloads: {
    list(): Promise<DownloadJob[]>
    cancel(id: string): Promise<void>
    retry(id: string, overrideUrl?: string): Promise<void>
    clearFinished(): Promise<void>
  }
  lyrics: {
    get(trackId: string): Promise<LyricsData | null>
    fetch(trackId: string, opts?: { force?: boolean; genius?: boolean }): Promise<LyricsData>
    setGeniusUrl(trackId: string, url: string): Promise<LyricsData>
    setManual(trackId: string, text: string): Promise<LyricsData>
    setSynced(trackId: string, lines: LyricLine[]): Promise<LyricsData>
    setOffset(trackId: string, offset: number): Promise<LyricsData | null>
  }
  presence: {
    update(info: PresenceInfo | null): Promise<void>
    status(): Promise<PresenceStatus>
  }
  analysis: {
    get(trackId: string): Promise<TrackAnalysis | null>
    similar(trackId: string, limit?: number): Promise<SimilarTrack[]>
  }
  align: {
    status(): Promise<AlignStatus>
    /** поставить в очередь все треки медиатеки, которым нужна синхронизация по звуку */
    library(): Promise<void>
  }
  sync: {
    status(): Promise<SyncStatus>
    signIn(mode: 'register' | 'login', server: string, username: string, password: string): Promise<SyncStatus>
    signOut(): Promise<SyncStatus>
    now(): Promise<SyncStatus>
    setAuto(auto: boolean): Promise<SyncStatus>
    downloadMissing(): Promise<number>
  }
  plugins: {
    list(): Promise<PluginInfo[]>
    openFolder(): Promise<void>
  }
  tools: {
    status(): Promise<BinariesStatus>
    ensure(): Promise<void>
    updateYtDlp(): Promise<void>
    yandexLogin(): Promise<string | null>
  }
  on(channel: 'library:track', cb: (p: { kind: 'upsert' | 'remove'; track: Track }) => void): () => void
  on(channel: 'library:playlists', cb: (p: Playlist[]) => void): () => void
  on(channel: 'downloads:update', cb: (j: DownloadJob) => void): () => void
  on(channel: 'downloads:removed', cb: (ids: string[]) => void): () => void
  on(channel: 'sync:status', cb: (s: SyncStatus) => void): () => void
  on(channel: 'tools:status', cb: (s: BinariesStatus) => void): () => void
  on(channel: 'settings:changed', cb: (s: Settings) => void): () => void
  on(channel: 'app:open-url', cb: (url: string) => void): () => void
  on(channel: 'align:status', cb: (s: AlignStatus) => void): () => void
  on(channel: 'lyrics:changed', cb: (trackId: string) => void): () => void
  on(channel: 'profile:changed', cb: (p: Profile) => void): () => void
}
