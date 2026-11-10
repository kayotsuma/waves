import type { Track } from '@shared/types'

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`
}

export function fmtSpeed(bps?: number): string {
  if (!bps) return ''
  return bps > 1024 * 1024 ? `${(bps / 1024 / 1024).toFixed(1)} МБ/с` : `${Math.round(bps / 1024)} КБ/с`
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export type QualityTier = 'lossless' | 'high' | 'good' | 'low'

export function quality(t: Track): { label: string; detail: string; short: string; tier: QualityTier } {
  if (t.remote) return { label: 'WEB', detail: 'из интернета', short: 'веб', tier: 'good' }
  const codec = (t.codec ?? '?').toUpperCase()
  if (t.lossless) {
    const depth = t.bitDepth ? `${t.bitDepth}-bit` : ''
    const rate = t.sampleRate ? `${+(t.sampleRate / 1000).toFixed(1)} kHz` : ''
    const short = t.bitDepth && t.sampleRate ? `${t.bitDepth}/${+(t.sampleRate / 1000).toFixed(1)}` : ''
    return { label: codec === 'PCM' ? 'WAV' : codec, detail: [depth, rate].filter(Boolean).join(' / ') || 'без потерь', short, tier: 'lossless' }
  }
  const br = t.bitrate ?? 0
  const tier: QualityTier = br >= 256 ? 'high' : br >= 150 ? 'good' : 'low'
  return { label: codec, detail: br ? `${br} kbps` : '', short: br ? `${br}k` : '', tier }
}

export const coverUrl = (t?: Pick<Track, 'id' | 'hasCover' | 'coverRev'> | null): string | undefined =>
  t?.hasCover ? `wave://cover/${t.id}?v=${t.coverRev}` : undefined

export const trackUrl = (t: Track): string => `wave://track/${t.id}`

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

export const tracksWord = (n: number) => `${n} ${plural(n, 'трек', 'трека', 'треков')}`

export function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

export function clamp(n: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, n))
}

/** высота строки списка треков для каждой плотности */
export const ROW_H = { compact: 46, comfortable: 58, roomy: 70 } as const
