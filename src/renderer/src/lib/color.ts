const cache = new Map<string, { accent: string; palette: string[] }>()

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Подбирает яркий акцентный цвет и небольшую палитру по обложке. */
export async function coverColors(url: string): Promise<{ accent: string; palette: string[] } | null> {
  const hit = cache.get(url)
  if (hit) return hit
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await img.decode()
    const S = 32
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, S, S)
    const data = ctx.getImageData(0, 0, S, S).data

    const buckets = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, l: 0 }))
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
      const w = s * s * (1 - Math.abs(l - 0.5) * 1.6)
      if (w <= 0.01) continue
      const b = buckets[Math.floor(h / 30) % 12]
      b.w += w
      b.h += h * w
      b.s += s * w
      b.l += l * w
    }
    const ranked = buckets.filter((b) => b.w > 0).sort((a, b) => b.w - a.w)
    if (!ranked.length) {
      // серая обложка
      const res = { accent: '#9aa0b4', palette: ['#3a3d4a', '#262833', '#1a1b24'] }
      cache.set(url, res)
      return res
    }
    const toHex = (b: (typeof ranked)[number], lMin: number, lMax: number) =>
      hslToHex(b.h / b.w, Math.max(0.5, Math.min(0.9, b.s / b.w)), Math.max(lMin, Math.min(lMax, b.l / b.w)))
    const res = {
      accent: toHex(ranked[0], 0.58, 0.66),
      palette: ranked.slice(0, 3).map((b) => toHex(b, 0.28, 0.45))
    }
    while (res.palette.length < 3) res.palette.push(res.palette[res.palette.length - 1])
    cache.set(url, res)
    return res
  } catch {
    return null
  }
}
