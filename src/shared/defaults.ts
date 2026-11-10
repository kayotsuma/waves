import type { AppearanceSettings, Settings } from './types'

/** Версия оформления (iOS-дизайн: плавающая боковая панель и мини-плеер, стекло). Увеличьте, чтобы снова сбросить внешний вид у всех. */
export const DESIGN_VERSION = 5

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export const EQ_PRESETS: Record<string, { label: string; gains: number[] }> = {
  flat: { label: 'Плоский', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Бас', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  vocal: { label: 'Вокал', gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  treble: { label: 'Высокие', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  loudness: { label: 'Громкость', gains: [5, 4, 1, 0, -1, -1, 0, 2, 4, 5] },
  acoustic: { label: 'Акустика', gains: [3, 3, 2, 1, 1, 1, 2, 3, 3, 2] },
  electronic: { label: 'Электроника', gains: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5] }
}

export const ENHANCE_PRESETS: Record<string, { label: string; values: { clarity: number; air: number; warmth: number; density: number } }> = {
  soft: { label: 'Мягко', values: { clarity: 0.3, air: 0.2, warmth: 0.25, density: 0.1 } },
  studio: { label: 'Студия', values: { clarity: 0.5, air: 0.35, warmth: 0.2, density: 0.3 } },
  vocal: { label: 'Вокал', values: { clarity: 0.85, air: 0.25, warmth: 0.1, density: 0.2 } },
  bright: { label: 'Яркий', values: { clarity: 0.5, air: 0.8, warmth: 0, density: 0.25 } }
}

export interface FxValues {
  tempo: number
  pitch: number
  reverb: number
  reverbDecay: number
  distortion: number
  bassBoost: number
}

export const FX_NEUTRAL: FxValues = { tempo: 1, pitch: 0, reverb: 0, reverbDecay: 2.4, distortion: 0, bassBoost: 0 }

export const FX_PRESETS: Record<string, { label: string; values: FxValues }> = {
  off: { label: 'Без эффектов', values: FX_NEUTRAL },
  nightcore: { label: 'Nightcore', values: { ...FX_NEUTRAL, tempo: 1.2, pitch: 3 } },
  slowed: { label: 'Slowed + Reverb', values: { ...FX_NEUTRAL, tempo: 0.85, pitch: -2, reverb: 0.45, reverbDecay: 3.2 } },
  bassboost: { label: 'Бас-буст', values: { ...FX_NEUTRAL, bassBoost: 8 } },
  hall: { label: 'Концертный зал', values: { ...FX_NEUTRAL, reverb: 0.35, reverbDecay: 4 } },
  lofi: { label: 'Lo-fi', values: { ...FX_NEUTRAL, tempo: 0.95, distortion: 0.12, reverb: 0.18, reverbDecay: 1.4 } },
  grit: { label: 'Грязный', values: { ...FX_NEUTRAL, distortion: 0.5, bassBoost: 3 } }
}

/** Внешний вид по умолчанию — iOS-дизайн Wave. */
export const DEFAULT_APPEARANCE = (): AppearanceSettings => ({
  theme: 'ios-dark',
  accent: '#6a5af9',
  accentFromCover: false,
  background: 'solid',
  blur: 30,
  dim: 0.55,
  radius: 16,
  font: 'system',
  density: 'comfortable',
  glass: true,
  glassStyle: 'liquid',
  glassOpacity: 0.62,
  glassTint: '',
  glassSaturation: 1.8,
  glassHighlight: 0.6,
  glassRefraction: false,
  scale: 1,
  fontScale: 1,
  titleSize: 34,
  titleWeight: 700,
  coverRadius: 1,
  buttonShape: 'capsule',
  shadows: 0.6,
  separators: true,
  iconStroke: 2,
  animations: true,
  animSpeed: 1,
  sidebarStyle: 'floating',
  sidebarWidth: 264,
  playerStyle: 'floating',
  searchPlacement: 'sidebar',
  cardSize: 176,
  colors: { bg: '', surface: '', text: '', text2: '', separator: '' },
  home: [
    { id: 'year', visible: true },
    { id: 'stats', visible: true },
    { id: 'quick', visible: true },
    { id: 'recent', visible: true },
    { id: 'top', visible: true },
    { id: 'playlists', visible: true }
  ],
  nav: { home: true, downloads: true, liked: true, tracks: true, albums: true, artists: true, playlists: true },
  lyricsSize: 34,
  lyricsAlign: 'left',
  lyricsBlurFar: true,
  lyricsWordSweep: true,
  showVisualizer: true,
  seekStyle: 'line',
  designVersion: DESIGN_VERSION
})

export const DEFAULT_SETTINGS = (musicDir: string): Settings => ({
  appearance: DEFAULT_APPEARANCE(),
  looks: [],
  audio: {
    volume: 0.8,
    muted: false,
    eqEnabled: false,
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    eqPreset: 'flat',
    normalize: true,
    targetLufs: -14,
    outputDeviceId: 'default',
    crossfade: 0,
    gapless: true,
    ...FX_NEUTRAL,
    fxPreset: 'off',
    ambient: { rain: 0, ocean: 0, fire: 0 },
    enhance: { enabled: false, clarity: 0.4, air: 0.3, warmth: 0.2, density: 0.2 }
  },
  download: {
    musicDir,
    concurrency: 3,
    cookiesFromBrowser: 'none',
    proxy: '',
    yandexToken: '',
    geniusToken: '',
    saveLrcFile: true,
    autoLyrics: true,
    alignLyrics: true,
    autoUpdateYtDlp: true
  },
  extensions: { customCss: '', enabledPlugins: [] },
  integrations: { discord: { enabled: false, clientId: '' } }
})
