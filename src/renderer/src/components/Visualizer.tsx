import { useEffect, useRef } from 'react'
import { engine } from '@/lib/audio'

/** Лёгкий спектр на canvas: 48 скруглённых столбиков. */
export function Visualizer({ playing, height = 56 }: { playing: boolean; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const N = 48
    const levels = new Float32Array(N)
    let raf = 0
    let buf: Uint8Array<ArrayBuffer> | null = null

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const an = engine.analyser
      if (an && playing) {
        buf = buf ?? new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(buf)
      }
      const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#7c5cff'
      const gap = 3
      const bw = (w - gap * (N - 1)) / N
      ctx.fillStyle = accent
      for (let i = 0; i < N; i++) {
        let target = 0
        if (buf && playing) {
          // логарифмическое распределение по спектру (низы шире)
          const from = Math.floor(Math.pow(i / N, 1.7) * buf.length * 0.75)
          const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / N, 1.7) * buf.length * 0.75))
          let sum = 0
          for (let k = from; k < to; k++) sum += buf[k]
          target = sum / (to - from) / 255
        }
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.5 : 0.12)
        const bh = Math.max(3, levels[i] * h)
        const x = i * (bw + gap)
        ctx.globalAlpha = 0.35 + levels[i] * 0.65
        ctx.beginPath()
        ctx.roundRect(x, h - bh, bw, bh, Math.min(bw / 2, 4))
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return <canvas ref={ref} className="visualizer" style={{ height }} aria-hidden />
}
