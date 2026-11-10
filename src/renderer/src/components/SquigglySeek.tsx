import { useEffect, useRef, useState } from 'react'
import { fmtTime } from '@/lib/format'

interface Props {
  value: number
  duration: number
  playing: boolean
  onChange: (t: number) => void
  onCommit: (t: number) => void
  height?: number
}

const LINE = 4
const WAVELEN = 22
const AMP = 3.2

/**
 * Волнистая полоса перемотки (как в Material 3 Expressive): пройденная часть «дышит» волной, пока играет музыка,
 * и выпрямляется на паузе. Клик/перетаскивание — перемотка, ←/→ (±5 с), Home/End.
 */
export function SquigglySeek({ value, duration, playing, onChange, onCommit, height = 28 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)
  const [width, setWidth] = useState(0)
  // актуальные значения для цикла анимации (без пересоздания rAF на каждый тик времени)
  const live = useRef({ value, duration, playing })
  live.current = { value, duration, playing }

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
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    const g = c.getContext('2d')!
    let raf = 0
    let phase = 0
    let amp = 0
    let last = performance.now()
    const mid = height / 2
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { value: v, duration: d, playing: p } = live.current
      const target = p && !reduce ? AMP : 0
      amp += (target - amp) * Math.min(1, dt * 8)
      if (p) phase += dt * 3.2
      const cs = getComputedStyle(c)
      const primary = cs.getPropertyValue('--accent').trim() || '#7c5cff'
      const track = cs.getPropertyValue('--hover-2').trim() || 'rgba(255,255,255,.14)'
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, width, height)
      g.lineCap = 'round'
      g.lineWidth = LINE
      const x = d > 0 ? Math.min(1, Math.max(0, v / d)) * (width - 6) + 3 : 3

      // непройденная часть — прямая линия
      g.strokeStyle = track
      g.beginPath()
      g.moveTo(x + 7, mid)
      g.lineTo(width - 3, mid)
      g.stroke()

      // пройденная — синусоида
      g.strokeStyle = primary
      g.beginPath()
      for (let px = 3; px <= x - 3; px += 1.5) {
        const y = mid + Math.sin((px / WAVELEN) * Math.PI * 2 - phase) * amp
        px === 3 ? g.moveTo(px, y) : g.lineTo(px, y)
      }
      g.stroke()

      // «ползунок»-палочка
      g.fillStyle = primary
      g.beginPath()
      g.roundRect(x - 2, mid - 9, 4, 18, 2)
      g.fill()

      // пока всё неподвижно (пауза, амплитуда ушла в ноль), цикл можно не гонять — перерисуем при изменении
      if (p || Math.abs(amp) > 0.02) raf = requestAnimationFrame(draw)
      else raf = 0
    }
    raf = requestAnimationFrame(draw)
    const kick = () => {
      if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }
    c.addEventListener('wave-kick', kick)
    return () => {
      cancelAnimationFrame(raf)
      c.removeEventListener('wave-kick', kick)
    }
  }, [width, height])

  // изменение позиции/состояния при остановленной анимации — один раз перерисовать
  useEffect(() => {
    ref.current?.dispatchEvent(new Event('wave-kick'))
  }, [value, duration, playing])

  const at = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left - 3) / (r.width - 6)))
  }

  return (
    <canvas
      ref={ref}
      className="squiggly-seek"
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
      onPointerMove={(e) => dragging.current && onChange(at(e) * duration)}
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
