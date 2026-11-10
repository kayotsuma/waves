import { join } from 'node:path'
import { DEFAULT_APPEARANCE, DEFAULT_SETTINGS, DESIGN_VERSION } from '@shared/defaults'
import type { AppearanceSettings, AudioSettings, DeepPartial, HomeSection, NavItem, Settings } from '@shared/types'
import { dataDir, defaultMusicDir } from './paths'
import { JsonStore, deepMerge } from './store'

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))
const num = (v: unknown, a: number, b: number, d: number) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? clamp(Number(v), a, b) : d)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const hexOrEmpty = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '')

const THEME_IDS = ['ios-dark', 'ios-light', 'material', 'material-light', 'midnight', 'amoled', 'graphite', 'light', 'mocha', 'forest'] as const
const HOME_IDS: HomeSection[] = ['year', 'stats', 'quick', 'recent', 'top', 'playlists']
const NAV_IDS: NavItem[] = ['home', 'downloads', 'liked', 'tracks', 'albums', 'artists', 'playlists']

/** Приводит внешний вид к допустимым значениям (в том числе для стилей, импортированных из файла). */
export function sanitizeAppearance(a: AppearanceSettings): AppearanceSettings {
  const d = DEFAULT_APPEARANCE()
  a.theme = oneOf(a.theme, THEME_IDS, d.theme)
  a.font = oneOf(a.font, ['system', 'inter', 'google-sans', 'manrope', 'space-grotesk'] as const, d.font)
  a.background = oneOf(a.background, ['solid', 'cover', 'gradient', 'image'] as const, d.background)
  a.density = oneOf(a.density, ['compact', 'comfortable', 'roomy'] as const, d.density)
  a.glassStyle = oneOf(a.glassStyle, ['off', 'frosted', 'liquid'] as const, d.glassStyle)
  a.glass = a.glassStyle !== 'off'
  a.glassOpacity = num(a.glassOpacity, 0, 1, d.glassOpacity)
  a.glassTint = hexOrEmpty(a.glassTint)
  a.glassSaturation = num(a.glassSaturation, 1, 3, d.glassSaturation)
  a.glassHighlight = num(a.glassHighlight, 0, 1, d.glassHighlight)
  a.glassRefraction = a.glassRefraction === true
  a.scale = num(a.scale, 0.8, 1.3, 1)
  a.fontScale = num(a.fontScale, 0.85, 1.3, 1)
  a.titleSize = num(a.titleSize, 22, 56, d.titleSize)
  a.titleWeight = Math.round(num(a.titleWeight, 400, 900, d.titleWeight) / 100) * 100
  a.coverRadius = num(a.coverRadius, 0, 2.5, 1)
  a.buttonShape = oneOf(a.buttonShape, ['capsule', 'rounded', 'square'] as const, d.buttonShape)
  a.shadows = num(a.shadows, 0, 1, d.shadows)
  a.separators = a.separators !== false
  a.iconStroke = num(a.iconStroke, 1, 2.75, 2)
  a.animSpeed = num(a.animSpeed, 0.5, 2, 1)
  a.sidebarStyle = oneOf(a.sidebarStyle, ['floating', 'docked'] as const, d.sidebarStyle)
  a.sidebarWidth = Math.round(num(a.sidebarWidth, 220, 360, d.sidebarWidth))
  a.playerStyle = oneOf(a.playerStyle, ['floating', 'docked'] as const, d.playerStyle)
  a.searchPlacement = oneOf(a.searchPlacement, ['sidebar', 'toolbar'] as const, d.searchPlacement)
  a.cardSize = Math.round(num(a.cardSize, 130, 260, d.cardSize))
  const c = (a.colors ?? {}) as Partial<AppearanceSettings['colors']>
  a.colors = { bg: hexOrEmpty(c.bg), surface: hexOrEmpty(c.surface), text: hexOrEmpty(c.text), text2: hexOrEmpty(c.text2), separator: hexOrEmpty(c.separator) }
  const seen = new Set<HomeSection>()
  const home: AppearanceSettings['home'] = []
  for (const h of Array.isArray(a.home) ? a.home : []) {
    if (!h || !HOME_IDS.includes(h.id) || seen.has(h.id)) continue
    seen.add(h.id)
    home.push({ id: h.id, visible: h.visible !== false })
  }
  // новые разделы: «Итог года» — наверх, остальные — в конец
  for (const id of HOME_IDS) if (!seen.has(id)) id === 'year' ? home.unshift({ id, visible: true }) : home.push({ id, visible: true })
  a.home = home
  const nav = (a.nav ?? {}) as Partial<Record<NavItem, boolean>>
  a.nav = Object.fromEntries(NAV_IDS.map((k) => [k, nav[k] !== false])) as Record<NavItem, boolean>
  a.seekStyle = oneOf(a.seekStyle, ['squiggly', 'waveform', 'line'] as const, d.seekStyle)
  delete (a as unknown as Record<string, unknown>)['waveformSeek']
  a.blur = num(a.blur, 0, 80, d.blur)
  a.radius = num(a.radius, 0, 32, d.radius)
  a.dim = num(a.dim, 0, 1, d.dim)
  a.lyricsSize = num(a.lyricsSize, 16, 72, 34)
  a.lyricsAlign = oneOf(a.lyricsAlign, ['left', 'center'] as const, 'left')
  if (typeof a.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(a.accent)) a.accent = d.accent
  return a
}

export class SettingsService {
  private store: JsonStore<Settings>
  onChange: (s: Settings) => void = () => {}

  constructor() {
    const defaults = DEFAULT_SETTINGS(defaultMusicDir())
    this.store = new JsonStore<Settings>(join(dataDir(), 'settings.json'), defaults, (loaded, d) => {
      const merged = deepMerge(d, loaded)
      // у старого файла нет designVersion — без этого значение по умолчанию «прикрыло» бы необходимость перехода
      const had = (loaded as { appearance?: { designVersion?: number } })?.appearance?.designVersion ?? 1
      if (had < DESIGN_VERSION) merged.appearance.designVersion = had
      return this.sanitize(merged)
    })
  }

  get(): Settings {
    return this.store.data
  }

  patch(p: DeepPartial<Settings>): Settings {
    this.store.data = this.sanitize(deepMerge(this.store.data, p))
    this.store.save()
    this.onChange(this.store.data)
    return this.store.data
  }

  flush(): void {
    this.store.flush()
  }

  private sanitize(s: Settings): Settings {
    s.download.concurrency = clamp(Math.round(s.download.concurrency) || 3, 1, 6)
    s.audio.volume = clamp(Number(s.audio.volume) || 0, 0, 1)
    s.audio.targetLufs = clamp(Number(s.audio.targetLufs) || -14, -30, -6)
    if (!Array.isArray(s.audio.eqGains) || s.audio.eqGains.length !== 10) s.audio.eqGains = new Array(10).fill(0)
    s.audio.eqGains = s.audio.eqGains.map((g) => clamp(Number(g) || 0, -12, 12))
    const a = s.audio
    a.crossfade = clamp(Number(a.crossfade) || 0, 0, 12)
    a.tempo = clamp(Number(a.tempo) || 1, 0.5, 2)
    a.pitch = clamp(Number(a.pitch) || 0, -12, 12)
    a.reverb = clamp(Number(a.reverb) || 0, 0, 1)
    a.reverbDecay = clamp(Number(a.reverbDecay) || 2.4, 0.5, 6)
    a.distortion = clamp(Number(a.distortion) || 0, 0, 1)
    a.bassBoost = clamp(Number(a.bassBoost) || 0, 0, 12)
    if (!a.ambient || typeof a.ambient !== 'object') a.ambient = { rain: 0, ocean: 0, fire: 0 }
    for (const k of ['rain', 'ocean', 'fire'] as const) a.ambient[k] = clamp(Number(a.ambient[k]) || 0, 0, 1)
    const en = (a.enhance ?? {}) as Partial<AudioSettings['enhance']>
    a.enhance = {
      enabled: en.enabled === true,
      clarity: clamp(Number(en.clarity) || 0, 0, 1),
      air: clamp(Number(en.air) || 0, 0, 1),
      warmth: clamp(Number(en.warmth) || 0, 0, 1),
      density: clamp(Number(en.density) || 0, 0, 1)
    }
    // переход на новое оформление: один раз ставим новые значения внешнего вида (дальше пользователь меняет как хочет)
    if ((s.appearance.designVersion ?? 1) < DESIGN_VERSION) {
      const d = DEFAULT_APPEARANCE()
      Object.assign(s.appearance, {
        theme: d.theme,
        font: d.font,
        radius: d.radius,
        glass: d.glass,
        glassStyle: d.glassStyle,
        sidebarStyle: d.sidebarStyle,
        playerStyle: d.playerStyle,
        background: s.appearance.background === 'image' && s.appearance.backgroundImage ? 'image' : d.background,
        designVersion: DESIGN_VERSION
      })
    }
    sanitizeAppearance(s.appearance)
    s.looks = Array.isArray(s.looks)
      ? s.looks
          .filter((l) => l && typeof l === 'object' && typeof l.id === 'string' && l.appearance && typeof l.appearance === 'object')
          .slice(0, 60)
          .map((l) => ({ id: l.id.slice(0, 40), name: String(l.name ?? 'Стиль').slice(0, 60), createdAt: Number(l.createdAt) || Date.now(), appearance: l.appearance }))
      : []
    if (!s.extensions) s.extensions = { customCss: '', enabledPlugins: [] }
    s.extensions.customCss = typeof s.extensions.customCss === 'string' ? s.extensions.customCss.slice(0, 200_000) : ''
    s.extensions.enabledPlugins = Array.isArray(s.extensions.enabledPlugins)
      ? s.extensions.enabledPlugins.filter((x) => typeof x === 'string' && /^[\w.-]+$/.test(x))
      : []
    if (!s.integrations || typeof s.integrations !== 'object') s.integrations = { discord: { enabled: false, clientId: '' } }
    const dc = (s.integrations.discord ??= { enabled: false, clientId: '' })
    dc.enabled = dc.enabled === true
    dc.clientId = typeof dc.clientId === 'string' ? dc.clientId.replace(/\s+/g, '').slice(0, 25) : ''
    if (!s.download.musicDir) s.download.musicDir = defaultMusicDir()
    return s
  }
}
