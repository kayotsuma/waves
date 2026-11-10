import { useState } from 'react'
import { ArrowLeft, ArrowRight, Cloud, Gauge, Link2, MessageSquare, Palette, Sparkles, Waves } from 'lucide-react'
import { ACCENTS, THEMES } from '@/lib/themes'
import { useLibrary } from '@/store/library'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

const KEY = 'wave.onboarded'
const done = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

function Toggle({ icon, title, text, on, onChange }: { icon: React.ReactNode; title: string; text: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ob-row">
      <span className="ob-ico">{icon}</span>
      <span className="txt"><b>{title}</b><small>{text}</small></span>
      <span className="switch"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /><span /></span>
    </label>
  )
}

/** Приветствие при первом запуске: внешний вид, базовые настройки, подключения (по мотивам мастера из Riff). */
export function Onboarding() {
  const [open, setOpen] = useState(() => !done())
  const [step, setStep] = useState(0)
  const empty = useLibrary((s) => s.tracks.length === 0)
  const ap = useSettings((s) => s.settings.appearance)
  const audio = useSettings((s) => s.settings.audio)
  const dl = useSettings((s) => s.settings.download)
  const discord = useSettings((s) => s.settings.integrations.discord)
  const patch = useSettings((s) => s.patch)
  const ui = useUI.getState

  if (!open) return null
  // у тех, кто уже пользуется приложением, мастер не показываем
  if (!empty && step === 0) {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    return null
  }
  const finish = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }
  const last = 3
  const perf = !ap.animations && ap.blur === 0

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Приветствие">
      <button className="btn tonal sm ob-skip" onClick={finish}>Пропустить</button>
      <div className="ob-card" key={step}>
        {step === 0 && (
          <>
            <span className="ob-logo"><Waves size={56} strokeWidth={2.2} /></span>
            <h1>Wave</h1>
            <div className="ob-panel">
              <h2>Добро пожаловать!</h2>
              <p>Это ваш плеер для музыки из интернета и с диска: загрузка по ссылке, тексты песен, анализ треков. Давайте быстро настроим всё под вас.</p>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <div className="ob-panel">
              <h2>Выберите стиль</h2>
              <p>Тему и цвет акцента можно поменять в любой момент в настройках.</p>
              <div className="ob-themes">
                {THEMES.map((t) => (
                  <button key={t.id} className={`ob-theme ${ap.theme === t.id ? 'on' : ''}`} onClick={() => patch({ appearance: { theme: t.id } })}>
                    <span className="ob-sw" style={{ background: t.swatch[0] }}>
                      <i style={{ background: t.swatch[1] }} />
                      <b style={{ background: t.swatch[2] }} />
                    </span>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="ob-panel">
              <h3>Цвет акцента</h3>
              <div className="ob-accents">
                {ACCENTS.map((c) => (
                  <button key={c} className={ap.accent.toLowerCase() === c ? 'on' : ''} style={{ background: c }} onClick={() => patch({ appearance: { accent: c } })} aria-label={c} />
                ))}
              </div>
              <label className="ob-check">
                <input type="checkbox" checked={ap.accentFromCover} onChange={(e) => patch({ appearance: { accentFromCover: e.target.checked } })} />
                Подбирать цвет по обложке играющего трека
              </label>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="ob-panel">
              <h2>Настройте под себя</h2>
              <p>Всё это можно изменить позже.</p>
            </div>
            <Toggle icon={<Sparkles size={20} />} title="Автоматические тексты" text="Искать текст песни при добавлении трека" on={dl.autoLyrics} onChange={(v) => patch({ download: { autoLyrics: v } })} />
            <Toggle icon={<Palette size={20} />} title="Выравнивание громкости" text="Все треки играют примерно одинаково громко" on={audio.normalize} onChange={(v) => patch({ audio: { normalize: v } })} />
            <Toggle
              icon={<Gauge size={20} />}
              title="Режим производительности"
              text="Отключить размытие и тяжёлые анимации на слабых компьютерах"
              on={perf}
              onChange={(v) => patch({ appearance: v ? { animations: false, blur: 0, glass: false } : { animations: true, blur: 40, glass: true } })}
            />
          </>
        )}
        {step === 3 && (
          <>
            <div className="ob-panel">
              <h2>Подключите свой мир</h2>
              <p>Необязательно — это можно сделать когда угодно.</p>
            </div>
            <Toggle
              icon={<MessageSquare size={20} />}
              title="Статус в Discord"
              text={discord.clientId ? 'Показывать, что вы слушаете' : 'Понадобится свой Application ID — укажите его в настройках'}
              on={discord.enabled}
              onChange={(v) => patch({ integrations: { discord: { enabled: v } } })}
            />
            <button className="ob-row ob-btn" onClick={() => { finish(); ui().setScImportOpen(true) }}>
              <span className="ob-ico"><Cloud size={20} /></span>
              <span className="txt"><b>Импорт из SoundCloud</b><small>Лайки и плейлисты публичного профиля</small></span>
              <ArrowRight size={18} />
            </button>
            <button className="ob-row ob-btn" onClick={() => { finish(); ui().openImport() }}>
              <span className="ob-ico"><Link2 size={20} /></span>
              <span className="txt"><b>Добавить музыку по ссылке</b><small>YouTube, Spotify, Deezer, Apple Music и другие</small></span>
              <ArrowRight size={18} />
            </button>
          </>
        )}
        <div className="ob-nav">
          {step > 0 ? <button className="btn tonal" onClick={() => setStep(step - 1)}><ArrowLeft size={17} /> Назад</button> : <span />}
          <span className="ob-dots">{[0, 1, 2, 3].map((i) => <i key={i} className={i === step ? 'on' : ''} />)}</span>
          <button className="btn primary" onClick={() => (step === last ? finish() : setStep(step + 1))}>
            {step === last ? 'Поехали' : 'Дальше'} <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
