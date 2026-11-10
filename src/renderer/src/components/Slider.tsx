import { useRef, useState } from 'react'

interface Props {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  /** вызывается при отпускании (удобно для seek) */
  onCommit?: (v: number) => void
  className?: string
  title?: string
  disabled?: boolean
  'aria-label'?: string
}

/** Ползунок на базе input[type=range]: доступен с клавиатуры, заливка — через CSS-переменную. */
export function Slider({ value, min = 0, max = 1, step = 0.001, onChange, onCommit, className = '', title, disabled, ...rest }: Props) {
  const [drag, setDrag] = useState<number | null>(null)
  const dragging = useRef(false)
  const shown = drag ?? value
  const pct = max > min ? ((shown - min) / (max - min)) * 100 : 0
  return (
    <input
      type="range"
      className={`slider ${className}`}
      min={min}
      max={max}
      step={step}
      value={shown}
      disabled={disabled}
      title={title}
      aria-label={rest['aria-label']}
      style={{ ['--p' as string]: `${pct}%` }}
      onPointerDown={() => (dragging.current = true)}
      onInput={(e) => {
        const v = Number((e.target as HTMLInputElement).value)
        if (onCommit) setDrag(v)
        onChange(v)
      }}
      onPointerUp={(e) => {
        dragging.current = false
        if (onCommit) {
          onCommit(Number((e.target as HTMLInputElement).value))
          setDrag(null)
        }
      }}
      onKeyUp={(e) => {
        if (onCommit && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
          onCommit(Number((e.target as HTMLInputElement).value))
          setDrag(null)
        }
      }}
      onChange={() => {}}
    />
  )
}
