import { useEffect, useState } from 'react'
import { useSleep } from '@/lib/sleep'

const OPTIONS = [15, 30, 45, 60, 90]

/** Таймер сна: через N минут или после текущего трека. Звук плавно затихает ~10 секунд. */
export function SleepPanel() {
  const { endsAt, afterTrack, inMinutes, afterCurrentTrack, cancel } = useSleep()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [])
  const left = endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 60_000)) : 0
  const active = endsAt !== null || afterTrack

  return (
    <div className="eq-panel fx-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="eq-head">
        <strong>Таймер сна</strong>
        <button className="chip" disabled={!active} onClick={cancel}>Отменить</button>
      </div>
      <div className="eq-presets">
        {OPTIONS.map((m) => (
          <button key={m} className={`chip ${endsAt && left === m ? 'on' : ''}`} onClick={() => inMinutes(m)}>{m} мин</button>
        ))}
        <button className={`chip ${afterTrack ? 'on' : ''}`} onClick={afterCurrentTrack}>До конца трека</button>
      </div>
      <p className="hint">
        {endsAt ? `Остановлю через ~${left} мин.` : afterTrack ? 'Остановлюсь, когда доиграет текущий трек (без перехода к следующему).' : 'Не включён.'}{' '}
        Музыка и эмбиент плавно затихнут, эмбиент после этого выключится.
      </p>
    </div>
  )
}
