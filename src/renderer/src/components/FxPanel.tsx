import { FX_NEUTRAL, FX_PRESETS, type FxValues } from '@shared/defaults'
import { useSettings } from '@/store/settings'
import { Slider } from './Slider'

function FxRow({ label, value, min, max, step, unit, fmt, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  fmt?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="fx-row">
      <span>{label}</span>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} aria-label={label} />
      <span className="val">{fmt ? fmt(value) : value}{unit}</span>
    </div>
  )
}

/** Звуковые эффекты: темп, тон, бас, дисторшн, реверберация. Все выключены по умолчанию. */
export function FxPanel() {
  const au = useSettings((s) => s.settings.audio)
  const patch = useSettings((s) => s.patch)
  const set = (p: Partial<FxValues>) => patch({ audio: { ...p, fxPreset: 'custom' } })
  const sign = (v: number) => (v > 0 ? `+${v}` : String(v))

  return (
    <div className="eq-panel fx-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="eq-head">
        <strong>Эффекты</strong>
        <button className="chip" onClick={() => patch({ audio: { ...FX_NEUTRAL, fxPreset: 'off' } })}>Сбросить</button>
      </div>
      <div className="eq-presets">
        {Object.entries(FX_PRESETS).map(([id, p]) => (
          <button key={id} className={`chip ${au.fxPreset === id ? 'on' : ''}`} onClick={() => patch({ audio: { ...p.values, fxPreset: id } })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="fx-rows">
        <FxRow label="Темп" value={au.tempo} min={0.5} max={2} step={0.01} fmt={(v) => `×${v.toFixed(2)}`} onChange={(v) => set({ tempo: v })} />
        <FxRow label="Тон" value={au.pitch} min={-12} max={12} step={0.5} unit=" пт" fmt={sign} onChange={(v) => set({ pitch: v })} />
        <FxRow label="Бас" value={au.bassBoost} min={0} max={12} step={0.5} unit=" дБ" fmt={sign} onChange={(v) => set({ bassBoost: v })} />
        <FxRow label="Дисторшн" value={au.distortion} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ distortion: v })} />
        <FxRow label="Реверб" value={au.reverb} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ reverb: v })} />
        <FxRow label="Длина реверба" value={au.reverbDecay} min={0.5} max={6} step={0.1} unit=" с" fmt={(v) => v.toFixed(1)} onChange={(v) => set({ reverbDecay: v })} />
      </div>
      <p className="hint">Тон меняется отдельно от темпа. Чтобы не было перегруза, громкость при включении эффектов автоматически снижается.</p>
    </div>
  )
}
