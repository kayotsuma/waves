import { ENHANCE_PRESETS } from '@shared/defaults'
import { useSettings } from '@/store/settings'
import { Slider } from './Slider'

function Row({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="enh-row">
      <div className="enh-top"><span>{label}</span><span className="val">{Math.round(value * 100)}%</span></div>
      <Slider value={value} min={0} max={1} step={0.01} onChange={onChange} aria-label={label} />
      <small>{hint}</small>
    </div>
  )
}

/** Улучшение звука: набор фильтров поверх трека (не нейросеть и не восстановление потерянных данных). */
export function EnhancePanel() {
  const en = useSettings((s) => s.settings.audio.enhance)
  const patch = useSettings((s) => s.patch)
  const set = (p: Partial<typeof en>) => patch({ audio: { enhance: p } })
  const matches = (v: (typeof ENHANCE_PRESETS)[string]['values']) => (['clarity', 'air', 'warmth', 'density'] as const).every((k) => Math.abs(en[k] - v[k]) < 0.01)
  return (
    <div className="eq-panel fx-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="eq-head">
        <strong>Улучшение звука</strong>
        <label className="switch">
          <input type="checkbox" checked={en.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span />
        </label>
      </div>
      <div className="eq-presets">
        {Object.entries(ENHANCE_PRESETS).map(([id, p]) => (
          <button key={id} className={`chip ${en.enabled && matches(p.values) ? 'on' : ''}`} onClick={() => set({ ...p.values, enabled: true })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className={`enh-rows ${en.enabled ? '' : 'off'}`}>
        <Row label="Ясность вокала" hint="Подчёркивает голос и убирает «муть» в низкой середине" value={en.clarity} onChange={(v) => set({ clarity: v })} />
        <Row label="Воздух" hint="Добавляет верхам открытость и лёгкий блеск" value={en.air} onChange={(v) => set({ air: v })} />
        <Row label="Тепло" hint="Подчёркивает нижнюю середину и бас" value={en.warmth} onChange={(v) => set({ warmth: v })} />
        <Row label="Плотность" hint="Мягко выравнивает динамику, звук собраннее" value={en.density} onChange={(v) => set({ density: v })} />
      </div>
      <p className="hint">Это тонкая настройка тембра фильтрами и мягким компрессором. Она не «дорисовывает» качество, которого нет в файле, — лучше всего заметна на плоско звучащих записях. Громкость при включении автоматически снижается, чтобы не было перегруза.</p>
    </div>
  )
}
