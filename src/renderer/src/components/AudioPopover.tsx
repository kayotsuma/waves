import { useState } from 'react'
import { CloudRain, Moon, Sparkles, SlidersHorizontal, Waves, X } from 'lucide-react'
import { useSettings } from '@/store/settings'
import { useSleep } from '@/lib/sleep'
import { AmbientPanel } from './AmbientPanel'
import { EnhancePanel } from './EnhancePanel'
import { EqPanel } from './EqPanel'
import { FxPanel } from './FxPanel'
import { SleepPanel } from './SleepPanel'

type Tab = 'enh' | 'eq' | 'fx' | 'amb' | 'sleep'

/** Единое окно «Аудио»: слева разделы, справа настройки (как в Riff). */
export function AudioPopover() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('enh')
  const audio = useSettings((s) => s.settings.audio)
  const sleepActive = useSleep((s) => s.endsAt !== null || s.afterTrack)
  const fx = audio.tempo !== 1 || audio.pitch !== 0 || audio.reverb > 0 || audio.distortion > 0 || audio.bassBoost > 0
  const amb = audio.ambient.rain > 0 || audio.ambient.ocean > 0 || audio.ambient.fire > 0
  const items: { id: Tab; label: string; Icon: typeof Moon; on: boolean }[] = [
    { id: 'enh', label: 'Улучшение', Icon: Sparkles, on: audio.enhance.enabled },
    { id: 'eq', label: 'Эквалайзер', Icon: SlidersHorizontal, on: audio.eqEnabled },
    { id: 'fx', label: 'Эффекты', Icon: Waves, on: fx },
    { id: 'amb', label: 'Эмбиент', Icon: CloudRain, on: amb },
    { id: 'sleep', label: 'Таймер сна', Icon: Moon, on: sleepActive }
  ]
  return (
    <div className="popover-wrap">
      <button className={`icon-btn ${open || audio.enhance.enabled || audio.eqEnabled || fx || amb || sleepActive ? 'active' : ''}`} onClick={() => setOpen(!open)} title="Аудио" aria-label="Аудио">
        <SlidersHorizontal size={18} />
      </button>
      {open && (
        <>
          <div className="popover-scrim" onMouseDown={() => setOpen(false)} />
          <div className="popover audio-pop" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <h4><SlidersHorizontal size={18} /> Аудио</h4>
              <button className="icon-btn sm" onClick={() => setOpen(false)} aria-label="Закрыть"><X size={16} /></button>
            </header>
            <div className="audio-body">
              <nav>
                {items.map(({ id, label, Icon, on }) => (
                  <button key={id} className={`${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                    <Icon size={18} /> {label}
                    {on && <i className="dot" />}
                  </button>
                ))}
              </nav>
              <div className="audio-content">
                {tab === 'enh' ? <EnhancePanel /> : tab === 'eq' ? <EqPanel /> : tab === 'fx' ? <FxPanel /> : tab === 'amb' ? <AmbientPanel /> : <SleepPanel />}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
