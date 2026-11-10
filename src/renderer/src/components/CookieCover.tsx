import { useMemo } from 'react'
import type { Track } from '@shared/types'
import { Cover } from './Cover'

/** Контур «печенья» (в духе фигур M3 Expressive): окружность с плавными лепестками → CSS polygon(). */
function cookiePath(petals: number, depth = 0.05, steps = 144): string {
  const pts: string[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const r = 50 * (1 - depth + depth * Math.cos(petals * a))
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)}% ${(50 + r * Math.sin(a)).toFixed(2)}%`)
  }
  return `polygon(${pts.join(',')})`
}

/** Обложка в форме «печенья»; медленно вращается, пока играет музыка. */
export function CookieCover({ track, size, spinning, petals = 9 }: { track?: Track | null; size: number; spinning: boolean; petals?: number }) {
  const clip = useMemo(() => cookiePath(petals), [petals])
  return (
    <span className={`cookie ${spinning ? 'spin' : ''}`} style={{ width: size, height: size, clipPath: clip, WebkitClipPath: clip }}>
      <Cover track={track} size="100%" radius={0} eager />
    </span>
  )
}
