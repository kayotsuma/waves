import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Scissors } from 'lucide-react'
import type { Track } from '@shared/types'
import { engine } from '@/lib/audio'
import { fmtTime, trackUrl } from '@/lib/format'
import { useAnalysis } from '@/store/analysis'
import { useUI } from '@/store/ui'
import { Modal } from './Overlays'

const H = 84

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
function parseTime(v: string): number | null {
  const m = v.trim().replace(',', '.').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/)
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null
}

/** Вырезать фрагмент трека без перекодирования и сохранить как новый трек. */
export function TrimModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const toast = useUI((s) => s.toast)
  const { data } = useAnalysis(track.id)
  const dur = track.duration
  const [range, setRange] = useState<[number, number]>([0, dur])
  const [texts, setTexts] = useState<[string, string]>([fmt(0), fmt(dur)])
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<0 | 1 | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const [pos, setPos] = useState<number | null>(null)
  const [width, setWidth] = useState(0)

  const setR = (r: [number, number]) => {
    setRange(r)
    setTexts([fmt(r[0]), fmt(r[1])])
  }

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ro = new ResizeObserver(() => setWidth(c.clientWidth))
    ro.observe(c)
    setWidth(c.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => void audio.current?.pause(), [])

  const peaks = data?.peaks
  useEffect(() => {
    const c = canvas.current
    if (!c || !width) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(H * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cs = getComputedStyle(c)
    const accent = cs.getPropertyValue('--accent').trim() || '#7c5cff'
    const fg = cs.getPropertyValue('--fg').trim() || '#fff'
    const n = Math.floor(width / 4)
    const x0 = (range[0] / dur) * width
    const x1 = (range[1] / dur) * width
    for (let i = 0; i < n; i++) {
      const x = i * (width / n)
      const v = peaks ? Math.max(...peaks.slice(Math.floor((i / n) * peaks.length), Math.max(Math.floor((i / n) * peaks.length) + 1, Math.floor(((i + 1) / n) * peaks.length)))) / 100 : 0.15
      const h = Math.max(2, v * (H - 6))
      const inside = x + 1.5 >= x0 && x <= x1
      g.globalAlpha = inside ? 1 : 0.25
      g.fillStyle = inside ? accent : fg
      g.beginPath()
      g.roundRect(x, (H - h) / 2, 2.5, h, 1.25)
      g.fill()
    }
    g.globalAlpha = 1
    g.fillStyle = fg
    for (const x of [x0, x1]) g.fillRect(Math.min(width - 3, Math.max(0, x - 1.5)), 0, 3, H) // ручки
    if (pos !== null) {
      g.fillStyle = '#fff'
      g.fillRect((pos / dur) * width - 0.5, 0, 1, H)
    }
  }, [peaks, range, width, dur, pos])

  const timeAt = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur))
  }
  const move = (which: 0 | 1, t: number) => {
    const gap = 0.5
    setR(which === 0 ? [Math.min(t, range[1] - gap), range[1]] : [range[0], Math.max(t, range[0] + gap)])
  }

  const commitText = (which: 0 | 1) => {
    const t = parseTime(texts[which])
    if (t === null) return setTexts([fmt(range[0]), fmt(range[1])])
    move(which, Math.min(dur, Math.max(0, t)))
  }

  const preview = () => {
    if (previewing) {
      audio.current?.pause()
      setPreviewing(false)
      setPos(null)
      return
    }
    engine.pause() // основной плеер молчит на время прослушивания
    const a = (audio.current ??= new Audio())
    a.src = trackUrl(track)
    a.currentTime = range[0]
    a.ontimeupdate = () => {
      setPos(a.currentTime)
      if (a.currentTime >= range[1]) {
        a.pause()
        setPreviewing(false)
        setPos(null)
      }
    }
    a.onloadedmetadata = () => (a.currentTime = range[0])
    void a.play().then(() => setPreviewing(true)).catch(() => toast('Не удалось проиграть фрагмент', 'error'))
  }

  const save = async () => {
    audio.current?.pause()
    setBusy(true)
    try {
      const t = await window.wave.library.trim(track.id, range[0], range[1])
      toast(`Фрагмент сохранён: «${t.title}»`, 'success')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Не удалось вырезать фрагмент', 'error')
    } finally {
      setBusy(false)
    }
  }

  const len = range[1] - range[0]
  const whole = range[0] <= 0.01 && range[1] >= dur - 0.01
  const hint = useMemo(() => (data ? '' : 'Волна ещё считается — границы можно задать и без неё.'), [data])

  return (
    <Modal
      title="Вырезать фрагмент"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy || whole} onClick={save}><Scissors size={15} /> {busy ? 'Режу…' : 'Сохранить как новый трек'}</button>
        </>
      }
    >
      <div className="trim">
        <p className="trim-title">{track.title} <span className="muted">· {track.artist}</span></p>
        <canvas
          ref={canvas}
          className="trim-canvas"
          style={{ height: H }}
          onPointerDown={(e) => {
            const t = timeAt(e)
            drag.current = Math.abs(t - range[0]) <= Math.abs(t - range[1]) ? 0 : 1
            e.currentTarget.setPointerCapture(e.pointerId)
            move(drag.current, t)
          }}
          onPointerMove={(e) => drag.current !== null && move(drag.current, timeAt(e))}
          onPointerUp={() => (drag.current = null)}
        />
        <div className="trim-fields">
          <label>Начало<input className="input sm" value={texts[0]} onChange={(e) => setTexts([e.target.value, texts[1]])} onBlur={() => commitText(0)} onKeyDown={(e) => e.key === 'Enter' && commitText(0)} /></label>
          <button className="btn" onClick={preview}>{previewing ? <Pause size={15} /> : <Play size={15} />} {previewing ? 'Стоп' : 'Прослушать'}</button>
          <label>Конец<input className="input sm" value={texts[1]} onChange={(e) => setTexts([texts[0], e.target.value])} onBlur={() => commitText(1)} onKeyDown={(e) => e.key === 'Enter' && commitText(1)} /></label>
        </div>
        <p className="hint">
          Длина фрагмента: {fmtTime(len)}. Звук копируется без перекодирования, поэтому качество не теряется, а границы привязываются к кадрам кодека (≈20–30 мс).
          Исходный трек не меняется; фрагмент появится в библиотеке как отдельный трек. {hint}
        </p>
      </div>
    </Modal>
  )
}
