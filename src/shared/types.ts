// Типы, общие для main, preload и renderer.

export type SourceKind = 'youtube' | 'soundcloud' | 'spotify' | 'apple' | 'deezer' | 'yandex' | 'local' | 'other'

export interface TrackSource {
  kind: SourceKind
  /** Идентификатор на исходной платформе (video id, spotify id, yandex track id ...) */
  id?: string
  url?: string
  /** Если трек найден по метаданным (Spotify → YouTube), здесь URL найденного источника */
  matchedUrl?: string
}

export interface Track {
  id: string
  title: string
  artist: string
  artists: string[]
  album?: string
  year?: number
  /** секунды */
  duration: number
  /** абсолютный путь к аудиофайлу */
  file: string
  hasCover: boolean
  coverRev: number
  size: number
  codec?: string
  /** kbps */
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  lossless?: boolean
  /** Интегральная громкость, LUFS (для нормализации) */
  loudness?: number
  /** Пик, dBFS */
  peak?: number
  source: TrackSource
  addedAt: number
  plays: number
  liked: boolean
  /** когда «любимое» менялось в последний раз (для синхронизации между устройствами) */
  likedAt?: number
  lastPlayedAt?: number
  /** файл не найден на диске */
  missing?: boolean
  /** «веб-трек»: файла нет, звук берётся из интернета при воспроизведении (ссылка в source.url) */
  remote?: boolean
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}

export interface LibrarySnapshot {
  tracks: Track[]
  playlists: Playlist[]
}

// ───────────── Настройки ─────────────

export type ThemeName =
  | 'ios-dark'
  | 'ios-light'
  | 'material'
  | 'material-light'
  | 'midnight'
  | 'amoled'
  | 'graphite'
  | 'light'
  | 'mocha'
  | 'forest'
/** стекло панелей: выключено, матовое (размытие) или «жидкое» (размытие + блики, кант и по желанию преломление) */
export type GlassStyle = 'off' | 'frosted' | 'liquid'
export type HomeSection = 'year' | 'stats' | 'quick' | 'recent' | 'top' | 'playlists'
export type NavItem = 'home' | 'downloads' | 'liked' | 'tracks' | 'albums' | 'artists' | 'playlists'
/** свои цвета поверх темы; пустая строка — цвет из темы */
export interface CustomColors {
  bg: string
  surface: string
  text: string
  text2: string
  separator: string
}
export type BackgroundMode = 'solid' | 'cover' | 'gradient' | 'image'
export type FontName = 'google-sans' | 'inter' | 'manrope' | 'space-grotesk' | 'system'

export interface AppearanceSettings {
  theme: ThemeName
  accent: string
  accentFromCover: boolean
  background: BackgroundMode
  /** 0..60, px blur для фона/стекла */
  blur: number
  /** 0..1 затемнение фонового изображения */
  dim: number
  /** 0..28 */
  radius: number
  font: FontName
  density: 'compact' | 'comfortable' | 'roomy'
  /** устарело: включено ли стекло (теперь — glassStyle) */
  glass: boolean
  glassStyle: GlassStyle
  /** плотность подложки стекла 0…1 (0 — почти прозрачное) */
  glassOpacity: number
  /** оттенок стекла, '' — цвет поверхности темы */
  glassTint: string
  /** насыщенность того, что видно сквозь стекло, 1…3 */
  glassSaturation: number
  /** блики и светлый кант «жидкого» стекла, 0…1 */
  glassHighlight: number
  /** преломление (искажение) фона под «жидким» стеклом */
  glassRefraction: boolean
  /** масштаб всего интерфейса 0.8…1.3 */
  scale: number
  /** размер текста 0.85…1.3 */
  fontScale: number
  /** крупные заголовки экранов, px */
  titleSize: number
  titleWeight: number
  /** множитель скругления обложек 0…2.5 */
  coverRadius: number
  buttonShape: 'capsule' | 'rounded' | 'square'
  /** сила теней 0…1 */
  shadows: number
  /** линии-разделители в списках */
  separators: boolean
  /** толщина линий иконок 1…2.75 */
  iconStroke: number
  /** скорость анимаций 0.5…2 (больше — медленнее) */
  animSpeed: number
  sidebarStyle: 'floating' | 'docked'
  sidebarWidth: number
  playerStyle: 'floating' | 'docked'
  searchPlacement: 'sidebar' | 'toolbar'
  /** размер карточек на полках и в сетках, px */
  cardSize: number
  colors: CustomColors
  /** разделы главной: порядок и видимость */
  home: { id: HomeSection; visible: boolean }[]
  /** пункты боковой панели */
  nav: Record<NavItem, boolean>
  animations: boolean
  lyricsSize: number
  lyricsAlign: 'left' | 'center'
  lyricsBlurFar: boolean
  lyricsWordSweep: boolean
  /** файл фона внутри userData (для background === 'image') */
  backgroundImage?: string
  showVisualizer: boolean
  /** вид полосы перемотки: волнистая линия, форма трека или обычная линия */
  seekStyle: 'squiggly' | 'waveform' | 'line'
  /** версия оформления: при смене дизайна настройки внешнего вида один раз переводятся на новые значения по умолчанию */
  designVersion: number
}

export interface AudioSettings {
  volume: number
  muted: boolean
  eqEnabled: boolean
  /** 10 полос: 31,62,125,250,500,1k,2k,4k,8k,16k — дБ */
  eqGains: number[]
  eqPreset: string
  normalize: boolean
  /** целевая громкость, LUFS */
  targetLufs: number
  outputDeviceId: string
  /** кроссфейд между треками, секунды (0 — выключен) */
  crossfade: number
  /** без паузы между треками, когда кроссфейд выключен */
  gapless: boolean
  /** темп без смены тона, 0.5…2 */
  tempo: number
  /** сдвиг тона, полутоны −12…+12 */
  pitch: number
  /** реверберация: доля эффекта 0…1 и длина «хвоста», с */
  reverb: number
  reverbDecay: number
  /** дисторшн 0…1 */
  distortion: number
  /** бас-буст, дБ 0…12 */
  bassBoost: number
  /** выбранный пресет эффектов ('custom' — свои значения) */
  fxPreset: string
  /** фоновые звуки поверх музыки, громкость каждого 0…1 */
  ambient: { rain: number; ocean: number; fire: number }
  /** «Улучшение звука»: ясность вокала, воздух, тепло и плотность, каждое 0…1 */
  enhance: { enabled: boolean; clarity: number; air: number; warmth: number; density: number }
}

export type BrowserName = 'none' | 'firefox' | 'chrome' | 'chromium' | 'brave' | 'edge' | 'vivaldi' | 'opera'

export interface DownloadSettings {
  musicDir: string
  concurrency: number
  /** Куки браузера для yt-dlp: даёт доступ к YouTube Premium / SoundCloud Go+ качеству */
  cookiesFromBrowser: BrowserName
  proxy: string
  yandexToken: string
  geniusToken: string
  saveLrcFile: boolean
  autoLyrics: boolean
  /** синхронизировать найденный текст по звуку локальной моделью (если готовой синхронизации нет) */
  alignLyrics: boolean
  autoUpdateYtDlp: boolean
}

/** Результат анализа трека (считается локально и кэшируется, на сервер синхронизации не уходит). */
export interface TrackAnalysis {
  v: number
  /** огибающая для полосы перемотки, значения 0..100 */
  peaks: number[]
  /** оценка темпа, уд/мин, и уверенность 0..1 */
  bpm?: number
  bpmConfidence?: number
  /** тональность: tonic 0..11 (C=0), camelot — код вида «8B» */
  key?: { tonic: number; mode: 'major' | 'minor'; camelot: string; confidence: number }
  /** LUFS и пик dBFS (из трека или измерено заново) */
  loudness?: number
  peak?: number
  /** пик минус громкость, дБ: чем больше, тем динамичнее запись */
  dynamics?: number
  /** «характер» звучания, 0..100 */
  energy: number
  bass: number
  vocal: number
  brightness: number
}

export interface SimilarTrack {
  trackId: string
  /** 0..100 */
  score: number
}

/** Что показываем в Discord Rich Presence. */
export interface PresenceInfo {
  title: string
  artist: string
  /** секунды */
  duration: number
  position: number
  playing: boolean
  /** ссылка на источник (только https) — кнопка «Listen» */
  url?: string
}

export interface PresenceStatus {
  enabled: boolean
  /** задан корректный Application ID */
  configured: boolean
  connected: boolean
  error?: string
}

export interface IntegrationSettings {
  discord: { enabled: boolean; clientId: string }
}

export interface ExtensionSettings {
  /** собственный CSS: применяется поверх темы */
  customCss: string
  /** id включённых плагинов (имена папок). Плагины выполняют код, поэтому по умолчанию всё выключено */
  enabledPlugins: string[]
}

export interface PluginInfo {
  id: string
  name: string
  version?: string
  author?: string
  description?: string
  hasCss: boolean
  hasJs: boolean
  enabled: boolean
}

/** сохранённый стиль оформления («Мои стили») */
export interface SavedLook {
  id: string
  name: string
  createdAt: number
  appearance: Partial<AppearanceSettings>
}

export interface Settings {
  appearance: AppearanceSettings
  looks: SavedLook[]
  audio: AudioSettings
  download: DownloadSettings
  extensions: ExtensionSettings
  integrations: IntegrationSettings
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] }

// ───────────── Импорт ─────────────

export type ImportFetch =
  | { type: 'url'; url: string }
  | { type: 'search'; query: string }
  | { type: 'yandex'; trackId: string; albumId?: string }

export interface ImportItem {
  key: string
  title: string
  artists: string[]
  album?: string
  year?: number
  duration?: number
  coverUrl?: string
  source: TrackSource
  fetch: ImportFetch
  /** трек уже есть в библиотеке */
  inLibrary?: boolean
}

export interface ImportPreview {
  sourceKind: SourceKind
  url: string
  kind: 'track' | 'album' | 'playlist' | 'artist'
  title: string
  subtitle?: string
  coverUrl?: string
  items: ImportItem[]
  notes: string[]
}

export type JobStatus = 'queued' | 'matching' | 'downloading' | 'processing' | 'done' | 'error' | 'canceled'

export interface DownloadJob {
  id: string
  item: ImportItem
  status: JobStatus
  progress: number
  speed?: number
  eta?: number
  error?: string
  trackId?: string
  /** подробность: "Поиск на YouTube Music…", "Opus 160 kbps" */
  detail?: string
  createdAt: number
}

// ───────────── Тексты ─────────────

export interface LyricWord {
  t: number
  text: string
}

export interface LyricLine {
  t: number
  text: string
  words?: LyricWord[]
}

export interface GeniusCandidate {
  url: string
  title: string
  artist: string
}

export type LyricsSource = 'lrclib' | 'yandex' | 'genius' | 'file' | 'manual' | 'estimated' | 'aligned'

/** Состояние автоматической синхронизации текста по звуку */
export interface AlignStatus {
  enabled: boolean
  /** модель выравнивания: не скачана / скачивается / готова / ошибка */
  model: 'missing' | 'downloading' | 'ready' | 'error'
  /** 0…1 — скачивание модели */
  progress?: number
  error?: string
  /** треков в очереди (без текущего) */
  queue: number
  /** первые треки очереди — чтобы показать «в очереди» у открытого трека */
  queued: string[]
  /** трек, который сейчас выравнивается */
  current?: string
  /** 0…1 — текущий трек */
  currentProgress?: number
  /** выровнено за эту сессию */
  done: number
}

export interface LyricsData {
  trackId: string
  /** версия алгоритма поиска: тексты без синхронизации, найденные старой версией, ищутся заново */
  v?: number
  synced?: LyricLine[]
  plain?: string
  /** откуда пришли синхронизированные */
  syncedSource?: LyricsSource
  plainSource?: LyricsSource
  geniusUrl?: string
  /** пояснение, если Genius не удалось получить (заблокировал/не найден) */
  geniusNote?: string
  /** страницы Genius, похожие на трек (когда точного совпадения нет) — пользователь выбирает сам */
  geniusCandidates?: GeniusCandidate[]
  /** сдвиг синхронизации, секунды */
  offset: number
  fetchedAt: number
  /** последняя попытка выровнять текст по звуку: для какого текста и насколько он подошёл к звуку */
  alignAttempt?: { plainHash: string; match: number; at: number }
}

// ───────────── Прочее ─────────────

export type ToolStatus =
  | { state: 'missing' }
  | { state: 'downloading'; progress: number }
  | { state: 'ready'; version?: string; path: string }
  | { state: 'error'; message: string }

export interface BinariesStatus {
  ytdlp: ToolStatus
  ffmpeg: ToolStatus
  jsRuntime: string | null
}

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
  dataDir: string
  defaultMusicDir: string
}

export interface TrackPatch {
  title?: string
  artist?: string
  album?: string
  year?: number
}

// ───── Аккаунт и синхронизация ─────

export interface SyncStatus {
  /** выполнен вход */
  signedIn: boolean
  server?: string
  username?: string
  auto: boolean
  syncing: boolean
  lastSync?: number
  error?: string
  /** треков с других устройств, которых нет на этом (можно скачать) */
  pending: number
}

// ───────────── История прослушиваний ─────────────

/** одно прослушивание: [id трека, начало (мс), сколько секунд реально звучало] */
export type ListenRow = [string, number, number]

export interface ListenMeta {
  title: string
  artist: string
  artists: string[]
  album?: string
  duration: number
}

export interface ListenYear {
  year: number
  rows: ListenRow[]
  /** название и исполнитель каждого трека — чтобы удалённые из медиатеки треки оставались в статистике */
  meta: Record<string, ListenMeta>
}

/** Счётчики прослушиваний, накопленные до появления истории: приблизительная часть статистики. */
export interface ListenBaseline {
  at: number
  tracks: Record<string, { plays: number; last: number; meta: ListenMeta }>
}

export interface ListenInfo {
  /** годы, за которые есть история */
  years: number[]
  /** с какого момента ведётся история */
  since: number
  baseline: ListenBaseline | null
}

// ───────────── Профиль и витрина ─────────────

export type ShowcaseBlockKind =
  | 'stats'
  | 'tracks'
  | 'artists'
  | 'albums'
  | 'track'
  | 'playlist'
  | 'nowPlaying'
  | 'text'
  | 'links'
  | 'badges'
  | 'activity'
  | 'clock'
  | 'year'
  | 'quote'

export type StatKey = 'minutes' | 'plays' | 'tracks' | 'artists' | 'albums' | 'liked' | 'playlists' | 'streak' | 'days' | 'lossless' | 'topHour' | 'since'
export type ShowcasePeriod = 'all' | 'year' | 'month' | 'week'
export type ShowcaseLayout = 'list' | 'grid' | 'podium' | 'row'

export interface ShowcaseBlock {
  id: string
  kind: ShowcaseBlockKind
  /** свой заголовок; пусто — заголовок по умолчанию */
  title: string
  size: 'half' | 'full'
  hidden: boolean
  /** топы: сами по статистике или выбранные вручную */
  mode: 'auto' | 'manual'
  period: ShowcasePeriod
  count: number
  layout: ShowcaseLayout
  /** вручную выбранное: id треков, имена исполнителей, ключи альбомов, показатели, значки */
  items: string[]
  /** текст блока «О себе»/«Цитата» */
  text: string
  links: { label: string; url: string }[]
  /** id трека или плейлиста */
  ref: string
  /** свой цвет блока, пусто — из темы профиля */
  accent: string
  /** год для блока «Итог года»; 0 — текущий */
  year: number
}

export type AvatarShape = 'circle' | 'squircle' | 'square'
export type AvatarFrame = 'none' | 'accent' | 'gradient' | 'glow' | 'spin'
export type ProfileCard = 'glass' | 'solid' | 'gradient' | 'outline'
export type ProfileEffect = 'none' | 'aurora' | 'stars' | 'grain' | 'waves' | 'snow' | 'bokeh'
export type NameStyle = 'plain' | 'gradient' | 'glow' | 'outline'

export interface Profile {
  displayName: string
  pronouns: string
  statusEmoji: string
  status: string
  bio: string
  /** data:-URL картинки (может быть GIF) или '' */
  avatar: string
  avatarShape: AvatarShape
  avatarFrame: AvatarFrame
  banner: {
    kind: 'gradient' | 'color' | 'image' | 'cover'
    /** data:-URL картинки баннера */
    image: string
    /** обложка какого трека — для kind 'cover' */
    trackId: string
    height: number
  }
  theme: {
    primary: string
    secondary: string
    angle: number
    card: ProfileCard
    effect: ProfileEffect
    font: FontName | 'app'
    radius: number
    nameStyle: NameStyle
    /** плотность стекла карточек 0…1 */
    opacity: number
  }
  blocks: ShowcaseBlock[]
  /** показывать витрину другим пользователям сервера синхронизации */
  publish: boolean
  /** показывать, что сейчас играет */
  shareNowPlaying: boolean
  updatedAt: number
}

/** Элемент блока, уже «развёрнутый» в данные: так витрина уходит на сервер и приходит от других. */
export interface ShowcaseItem {
  title: string
  sub?: string
  /** URL обложки: wave://cover/… у себя или data:-URL у чужого профиля */
  cover?: string
  /** число прослушиваний или другая величина для подписи */
  value?: string
  trackId?: string
  /** ключ для перехода: исполнитель/альбом */
  key?: string
}

export interface ShowcaseBadge {
  id: string
  label: string
  desc: string
  icon: string
  color: string
}

export interface YearCard {
  year: number
  minutes: number
  plays: number
  topTrack?: ShowcaseItem
  topArtist?: ShowcaseItem
  persona: string
  personaDesc: string
  artists: number
  tracks: number
}

export interface ResolvedBlock {
  stats?: { key: StatKey; label: string; value: string; hint?: string }[]
  items?: ShowcaseItem[]
  /** минуты по дням, последние 26 недель (старые первыми) */
  activity?: number[]
  activityEnd?: number
  /** доля прослушиваний по часам 0…23 */
  clock?: number[]
  badges?: ShowcaseBadge[]
  year?: YearCard
  playlist?: { name: string; count: number; covers: string[]; minutes: number }
  quoteBy?: ShowcaseItem
  nowPlaying?: (ShowcaseItem & { at: number }) | null
}

export interface ShowcaseData {
  profile: Profile
  /** id блока → данные */
  resolved: Record<string, ResolvedBlock>
  /** обложка для баннера типа «обложка трека» */
  bannerCover?: string
}

export interface PublicProfile extends ShowcaseData {
  username: string
  updatedAt: number
}

export interface ProfileListItem {
  username: string
  displayName: string
  thumb?: string
  statusEmoji?: string
  status?: string
  nowPlaying?: string
  updatedAt: number
}
