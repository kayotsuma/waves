import { RotateCcw } from 'lucide-react'
import { Slider } from './Slider'

// Элементы форм в стиле iOS — общие для настроек и редактора витрины.

export function Row({ title, desc, children, wide }: { title: string; desc?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`set-row ${wide ? 'wide' : ''}`}>
      <div className="set-label">
        <strong>{title}</strong>
        {desc && <span>{desc}</span>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}

export function Range2({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="range-field">
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
      <span className="val">{format(value)}</span>
    </div>
  )
}

export function Group({ title, note, children }: { title?: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {title && <h3>{title}</h3>}
      <div className="ios-group">{children}</div>
      {note && <p className="ios-group-note">{note}</p>}
    </>
  )
}

export function ColorField({ value, fallback, onChange, label }: { value: string; fallback: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="color-row">
      {!value && <span className="from-theme">Из темы</span>}
      <input type="color" value={value || fallback} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      {value && <button className="icon-btn sm" onClick={() => onChange('')} aria-label={`${label}: вернуть цвет темы`} title="Вернуть цвет темы"><RotateCcw size={15} /></button>}
    </div>
  )
}
