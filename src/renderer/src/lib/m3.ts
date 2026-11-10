import { Hct, MaterialDynamicColors, SchemeTonalSpot, argbFromHex, hexFromArgb } from '@material/material-color-utilities'

/**
 * Палитра Material 3 из одного цвета («Material You»): настоящий алгоритм Google (HCT, тональные палитры),
 * а не подбор оттенков на глаз. Возвращает CSS-переменные для :root.
 */
const NAMES: Record<string, string> = {
  '--md-primary': 'primary',
  '--md-on-primary': 'onPrimary',
  '--md-primary-container': 'primaryContainer',
  '--md-on-primary-container': 'onPrimaryContainer',
  '--md-secondary-container': 'secondaryContainer',
  '--md-on-secondary-container': 'onSecondaryContainer',
  '--md-tertiary-container': 'tertiaryContainer',
  '--s-lowest': 'surfaceContainerLowest',
  '--s-low': 'surfaceContainerLow',
  '--s': 'surfaceContainer',
  '--s-high': 'surfaceContainerHigh',
  '--s-highest': 'surfaceContainerHighest',
  '--md-surface': 'surface',
  '--md-on-surface': 'onSurface',
  '--md-on-surface-variant': 'onSurfaceVariant',
  '--md-outline': 'outline',
  '--md-outline-variant': 'outlineVariant'
}

export const M3_VARS = [
  ...Object.keys(NAMES),
  '--bg', '--bg-rgb', '--panel', '--panel-solid', '--raised', '--hover', '--hover-2', '--fg', '--fg-2', '--fg-3', '--line', '--on-accent', '--shadow', '--scroll', '--scroll-hover'
]

const cache = new Map<string, Record<string, string>>()

export function m3Vars(seed: string, dark: boolean): Record<string, string> {
  const key = `${seed}|${dark}`
  const hit = cache.get(key)
  if (hit) return hit
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), dark, 0)
  const c = (name: string) => hexFromArgb((MaterialDynamicColors as unknown as Record<string, { getArgb: (s: SchemeTonalSpot) => number }>)[name].getArgb(scheme))
  const out: Record<string, string> = {}
  for (const [css, name] of Object.entries(NAMES)) out[css] = c(name)

  // токены, на которых построен остальной интерфейс Wave
  const bg = c('surface')
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))
  Object.assign(out, {
    '--bg': bg,
    '--bg-rgb': `${r} ${g} ${b}`,
    '--panel-solid': c('surfaceContainerLow'),
    '--panel': `color-mix(in srgb, ${c('surfaceContainerLow')} 82%, transparent)`,
    '--raised': c('surfaceContainerHigh'),
    '--hover': `color-mix(in srgb, ${c('onSurface')} 8%, transparent)`,
    '--hover-2': `color-mix(in srgb, ${c('onSurface')} 13%, transparent)`,
    '--fg': c('onSurface'),
    '--fg-2': c('onSurfaceVariant'),
    '--fg-3': c('outline'),
    '--line': `color-mix(in srgb, ${c('outlineVariant')} 45%, transparent)`,
    '--on-accent': c('onPrimary'),
    '--shadow': dark ? '0 6px 24px rgb(0 0 0 / 0.28)' : '0 6px 24px rgb(40 30 30 / 0.12)',
    '--scroll': `color-mix(in srgb, ${c('onSurface')} 22%, transparent)`,
    '--scroll-hover': `color-mix(in srgb, ${c('onSurface')} 38%, transparent)`
  })
  cache.set(key, out)
  return out
}
