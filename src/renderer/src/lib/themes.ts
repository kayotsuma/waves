import type { AppearanceSettings, FontName, ThemeName } from '@shared/types'

export const THEMES: { id: ThemeName; name: string; swatch: [string, string, string]; light?: boolean; material?: boolean }[] = [
  { id: 'ios-dark', name: 'iOS тёмная', swatch: ['#000000', '#1c1c1e', '#3a3a3c'] },
  { id: 'ios-light', name: 'iOS светлая', swatch: ['#f2f2f7', '#ffffff', '#d1d1d6'], light: true },
  { id: 'midnight', name: 'Полночь', swatch: ['#0a0a11', '#1b1b2d', '#3a3a55'] },
  { id: 'amoled', name: 'AMOLED', swatch: ['#000000', '#151518', '#333338'] },
  { id: 'graphite', name: 'Графит', swatch: ['#0e0e10', '#242428', '#3c3c42'] },
  { id: 'mocha', name: 'Мокко', swatch: ['#120d0a', '#2e2019', '#4d382c'] },
  { id: 'forest', name: 'Лес', swatch: ['#07100c', '#163025', '#2a4a3b'] },
  { id: 'light', name: 'Светлая', swatch: ['#e9ebf3', '#ffffff', '#c8cbd8'], light: true },
  { id: 'material', name: 'Material You', swatch: ['#1a1110', '#322826', '#ffb4a9'], material: true },
  { id: 'material-light', name: 'Material светлая', swatch: ['#fff8f7', '#f8ddd9', '#8f4c42'], light: true, material: true }
]

export const ACCENTS = ['#6a5af9', '#0a84ff', '#2bb0c8', '#30b566', '#a6e22e', '#e8a100', '#ff6b3d', '#f2416b', '#ff4fd8', '#8e8e93']

export const FONTS: { id: FontName; name: string; css: string }[] = [
  { id: 'system', name: 'Системный (SF на macOS)', css: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter Variable', system-ui, 'Segoe UI', Roboto, sans-serif" },
  { id: 'inter', name: 'Inter', css: "'Inter Variable', system-ui, sans-serif" },
  { id: 'google-sans', name: 'Google Sans', css: "'Google Sans Variable', 'Inter Variable', system-ui, sans-serif" },
  { id: 'manrope', name: 'Manrope', css: "'Manrope Variable', system-ui, sans-serif" },
  { id: 'space-grotesk', name: 'Space Grotesk', css: "'Space Grotesk Variable', system-ui, sans-serif" }
]

/** Поля внешнего вида, которые входят в «стиль» (без служебных и без файла фона). */
export const LOOK_KEYS = [
  'theme', 'accent', 'accentFromCover', 'background', 'blur', 'dim', 'radius', 'font', 'density', 'glassStyle', 'glassOpacity', 'glassTint',
  'glassSaturation', 'glassHighlight', 'glassRefraction', 'scale', 'fontScale', 'titleSize', 'titleWeight', 'coverRadius', 'buttonShape',
  'shadows', 'separators', 'iconStroke', 'animations', 'animSpeed', 'sidebarStyle', 'sidebarWidth', 'playerStyle', 'searchPlacement',
  'cardSize', 'colors', 'home', 'nav', 'lyricsSize', 'lyricsAlign', 'lyricsBlurFar', 'lyricsWordSweep', 'showVisualizer', 'seekStyle'
] as const satisfies readonly (keyof AppearanceSettings)[]

export function pickLook(ap: AppearanceSettings): Partial<AppearanceSettings> {
  const out: Record<string, unknown> = {}
  for (const k of LOOK_KEYS) out[k] = structuredClone(ap[k])
  return out as Partial<AppearanceSettings>
}

/** Готовые стили: каждый меняет только перечисленные поля, остальное остаётся как было. */
export const PRESETS: { id: string; name: string; desc: string; look: Partial<AppearanceSettings> }[] = [
  {
    id: 'ios',
    name: 'iOS',
    desc: 'Тёмная, жидкое стекло, плавающие панели',
    look: {
      theme: 'ios-dark', accent: '#6a5af9', accentFromCover: false, background: 'solid', glassStyle: 'liquid', glassOpacity: 0.62, glassSaturation: 1.8,
      glassHighlight: 0.6, glassRefraction: false, blur: 30, radius: 16, buttonShape: 'capsule', sidebarStyle: 'floating', playerStyle: 'floating',
      font: 'system', titleSize: 34, titleWeight: 700, shadows: 0.6, separators: true, coverRadius: 1, density: 'comfortable'
    }
  },
  {
    id: 'ios-light',
    name: 'iOS светлая',
    desc: 'Светлые поверхности, синий акцент',
    look: {
      theme: 'ios-light', accent: '#0a84ff', accentFromCover: false, background: 'solid', glassStyle: 'liquid', glassOpacity: 0.7, glassSaturation: 1.8,
      glassHighlight: 0.7, blur: 30, radius: 16, buttonShape: 'capsule', sidebarStyle: 'floating', playerStyle: 'floating', font: 'system', shadows: 0.35
    }
  },
  {
    id: 'liquid',
    name: 'Жидкое стекло',
    desc: 'Фон из обложки, прозрачное стекло с преломлением',
    look: {
      theme: 'ios-dark', accentFromCover: true, background: 'cover', dim: 0.45, blur: 24, glassStyle: 'liquid', glassOpacity: 0.28, glassSaturation: 2.2,
      glassHighlight: 1, glassRefraction: true, radius: 20, buttonShape: 'capsule', sidebarStyle: 'floating', playerStyle: 'floating', shadows: 0.8
    }
  },
  {
    id: 'frosted',
    name: 'Матовое',
    desc: 'Градиент из обложки под плотным матовым стеклом',
    look: {
      theme: 'midnight', accentFromCover: true, background: 'gradient', dim: 0.35, blur: 40, glassStyle: 'frosted', glassOpacity: 0.55,
      glassSaturation: 1.5, glassHighlight: 0.3, glassRefraction: false, radius: 18, sidebarStyle: 'floating', playerStyle: 'floating'
    }
  },
  {
    id: 'amoled',
    name: 'AMOLED',
    desc: 'Чистый чёрный, без стекла, экономит экран',
    look: {
      theme: 'amoled', background: 'solid', glassStyle: 'off', shadows: 0, separators: true, sidebarStyle: 'docked', playerStyle: 'docked',
      radius: 12, buttonShape: 'rounded'
    }
  },
  {
    id: 'minimal',
    name: 'Минимализм',
    desc: 'Строгие углы, тонкие иконки, без теней',
    look: {
      theme: 'graphite', accent: '#8e8e93', accentFromCover: false, background: 'solid', glassStyle: 'off', radius: 6, coverRadius: 0.4,
      buttonShape: 'square', shadows: 0, iconStroke: 1.5, titleWeight: 600, separators: false, sidebarStyle: 'docked', playerStyle: 'docked',
      density: 'compact', font: 'inter'
    }
  },
  {
    id: 'cozy',
    name: 'Уютный',
    desc: 'Тёплая тема, крупные обложки, мягкие углы',
    look: {
      theme: 'mocha', accent: '#ff6b3d', accentFromCover: false, background: 'gradient', glassStyle: 'frosted', glassOpacity: 0.5, radius: 22,
      coverRadius: 1.6, cardSize: 210, density: 'roomy', font: 'manrope', titleWeight: 800, sidebarStyle: 'floating', playerStyle: 'floating'
    }
  }
]
