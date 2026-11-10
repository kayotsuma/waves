import { EQ_BANDS, EQ_PRESETS } from '@shared/defaults'
import { useSettings } from '@/store/settings'

const label = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f))

export function EqPanel() {
  const audio = useSettings((s) => s.settings.audio)
  const patch = useSettings((s) => s.patch)
  return (
    <div className="eq-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="eq-head">
        <strong>Эквалайзер</strong>
        <label className="switch">
          <input type="checkbox" checked={audio.eqEnabled} onChange={(e) => patch({ audio: { eqEnabled: e.target.checked } })} />
          <span />
        </label>
      </div>
      <div className="eq-presets">
        {Object.entries(EQ_PRESETS).map(([id, p]) => (
          <button
            key={id}
            className={`chip ${audio.eqPreset === id ? 'on' : ''}`}
            onClick={() => patch({ audio: { eqPreset: id, eqGains: p.gains, eqEnabled: true } })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className={`eq-bands ${audio.eqEnabled ? '' : 'off'}`}>
        {EQ_BANDS.map((f, i) => (
          <div key={f} className="eq-band">
            <span className="db">{audio.eqGains[i] > 0 ? '+' : ''}{audio.eqGains[i].toFixed(0)}</span>
            <input
              type="range"
              className="vslider"
              min={-12}
              max={12}
              step={0.5}
              value={audio.eqGains[i]}
              style={{ ['--p' as string]: `${((audio.eqGains[i] + 12) / 24) * 100}%` }}
              onChange={(e) => {
                const g = [...audio.eqGains]
                g[i] = Number(e.target.value)
                patch({ audio: { eqGains: g, eqPreset: 'custom', eqEnabled: true } })
              }}
              aria-label={`${f} Гц`}
            />
            <span className="hz">{label(f)}</span>
          </div>
        ))}
      </div>
      <p className="hint">Чтобы не было перегруза, при подъёме полос громкость автоматически снижается.</p>
    </div>
  )
}
