import { CloudRain, Flame, Waves, type LucideIcon } from 'lucide-react'
import type { AudioSettings } from '@shared/types'
import { useSettings } from '@/store/settings'
import { Slider } from './Slider'

type Amb = AudioSettings['ambient']

const CHANNELS: { key: keyof Amb; label: string; icon: LucideIcon }[] = [
  { key: 'rain', label: 'Дождь', icon: CloudRain },
  { key: 'ocean', label: 'Океан', icon: Waves },
  { key: 'fire', label: 'Камин', icon: Flame }
]

const MIXES: { label: string; values: Amb }[] = [
  { label: 'Дождь за окном', values: { rain: 0.55, ocean: 0, fire: 0 } },
  { label: 'Прибой', values: { rain: 0, ocean: 0.6, fire: 0 } },
  { label: 'У камина', values: { rain: 0, ocean: 0, fire: 0.55 } },
  { label: 'Дождь и камин', values: { rain: 0.45, ocean: 0, fire: 0.4 } },
  { label: 'Шторм', values: { rain: 0.7, ocean: 0.6, fire: 0 } }
]

/** Фоновые звуки поверх музыки. Синтезируются на лету, играют и когда музыка на паузе. */
export function AmbientPanel() {
  const amb = useSettings((s) => s.settings.audio.ambient)
  const patch = useSettings((s) => s.patch)
  const set = (v: Partial<Amb>) => patch({ audio: { ambient: v } })
  const active = amb.rain > 0 || amb.ocean > 0 || amb.fire > 0

  return (
    <div className="eq-panel fx-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="eq-head">
        <strong>Эмбиент</strong>
        <button className="chip" disabled={!active} onClick={() => set({ rain: 0, ocean: 0, fire: 0 })}>Выключить</button>
      </div>
      <div className="eq-presets">
        {MIXES.map((m) => (
          <button key={m.label} className="chip" onClick={() => set(m.values)}>{m.label}</button>
        ))}
      </div>
      <div className="fx-rows">
        {CHANNELS.map(({ key, label, icon: Icon }) => (
          <div className="fx-row amb-row" key={key}>
            <span className="amb-name"><Icon size={16} />{label}</span>
            <Slider value={amb[key]} min={0} max={1} step={0.01} onChange={(v) => set({ [key]: v })} aria-label={label} />
            <span className="val">{Math.round(amb[key] * 100)}%</span>
          </div>
        ))}
      </div>
      <p className="hint">Звуки создаются прямо в приложении и смешиваются с музыкой. Они не зависят от эквалайзера и эффектов и продолжают играть на паузе.</p>
    </div>
  )
}
