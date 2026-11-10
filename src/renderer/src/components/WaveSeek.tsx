import { useEffect, useRef, useState } from 'react'
import { fmtTime } from '@/lib/format'

interface Props {
  peaks: number[]
  /** текущая позиция, с */
  value: number
  duration: number
  /** во время перетаскивания */
  onChange: (t: number) => void
  /** при отпускании / по клику / с клавиатуры */
  onCommit: (t: number) => void
  height?: number
}

const BAR = 2.5
const GAP = 1.5

/** Полоса перемотки в виде волны трека: клик и перетаскивание, стрелки ←/→ (±5 с), Home/End. */
export function WaveSeek({ peaks, value, duration, onChange, onCommit, height = 32 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ro = new ResizeObserver(() => setWidth(c.clientWidth))
    ro.observe(c)
    setWidth(c.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = ref.current
    if (!c || !width) return
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr)
      c.height = Math.round(height * dpr)
    }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    const cs = getComputedStyle(c)
    const accent = cs.getPropertyValue('--accent').trim() || '#7c5cff'
    const fg = cs.getPropertyValue('--fg').trim() || '#fff'

    const n = Math.max(8, Math.floor((width + GAP) / (BAR + GAP)))
    const step = (width + GAP) / n
    const frac = duration > 0 ? Math.min(1, Math.max(0, value / duration)) : 0
    const mid = height / 2
    for (let i = 0; i < n; i++) {
      // столбик — максимум по своему отрезку волны
      const from = Math.floor((i / n) * peaks.length)
      const to = Math.max(from + 1, Math.floor(((i + 1) / n) * peaks.length))
      let v = 0
      for (let k = from; k < to; k++) if (peaks[k] > v) v = peaks[k]
      const h = Math.max(2, (v / 100) * (height - 2))
      const x = i * step
      const played = (i + 0.5) / n <= frac
      const near = hover != null && Math.abs((i + 0.5) / n - hover) < 0.012
      g.globalAlpha = played ? 1 : near ? 0.7 : 0.3
      g.fillStyle = played ? accent : fg
      g.beginPath()
      g.roundRect(x, mid - h / 2, BAR, h, BAR / 2)
      g.fill()
    }
    g.globalAlpha = 1
  }, [peaks, value, duration, width, height, hover])

  const at = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }

  return (
    <canvas
      ref={ref}
      className="wave-seek"
      style={{ height }}
      role="slider"
      tabIndex={0}
      aria-label="Позиция"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${fmtTime(value)} из ${fmtTime(duration)}`}
      onPointerDown={(e) => {
        if (!duration) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        onChange(at(e) * duration)
      }}
      onPointerMove={(e) => {
        const f = at(e)
        setHover(f)
        if (dragging.current) onChange(f * duration)
      }}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        onCommit(at(e) * duration)
      }}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={(e) => {
        if (!duration) return
        const d = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0
        if (d) {
          e.preventDefault()
          onCommit(Math.min(duration, Math.max(0, value + d)))
        } else if (e.key === 'Home') onCommit(0)
        else if (e.key === 'End') onCommit(Math.max(0, duration - 1))
      }}
    />
  )
}
