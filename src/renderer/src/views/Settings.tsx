import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Download, ExternalLink, FolderOpen, Loader2, LogIn, RefreshCw, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { DEFAULT_APPEARANCE } from '@shared/defaults'
import type { AppearanceSettings, BrowserName, CustomColors, FontName, HomeSection, NavItem, PluginInfo, PresenceStatus, SavedLook, SyncStatus } from '@shared/types'
import { EqPanel } from '@/components/EqPanel'
import { FxPanel } from '@/components/FxPanel'
import { Slider } from '@/components/Slider'
import { ColorField, Group, Range2, Row, Seg, Toggle } from '@/components/Form'
import { ACCENTS, FONTS, LOOK_KEYS, PRESETS, THEMES, pickLook } from '@/lib/themes'
import { useDownloads } from '@/store/downloads'
import { useLibrary } from '@/store/library'
import { useLyrics } from '@/store/lyrics'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'




function Range({ value, min, max, step, onChange, suffix = '' }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="range-field">
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
      <span className="val">{Number.isInteger(step) ? value : value.toFixed(2)}{suffix}</span>
    </div>
  )
}

const TABS = [
  ['appearance', 'Оформление'],
  ['audio', 'Звук'],
  ['downloads', 'Загрузки и аккаунты'],
  ['library', 'Библиотека'],
  ['account', 'Аккаунт'],
  ['extensions', 'Расширения'],
  ['about', 'О программе']
] as const

export function SettingsView({ tab = 'appearance' }: { tab?: string }) {
  const navigate = useUI((s) => s.navigate)
  return (
    <div className="view scroll settings">
      <div className="view-head"><h1>Настройки</h1></div>
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => navigate({ name: 'settings', tab: id })}>{label}</button>
        ))}
      </div>
      <div className="set-body">
        {tab === 'appearance' && <Appearance />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'downloads' && <DownloadsTab />}
        {tab === 'library' && <LibraryTab />}
        {tab === 'account' && <AccountTab />}
        {tab === 'extensions' && <ExtensionsTab />}
        {tab === 'about' && <About />}
      </div>
    </div>
  )
}

const HOME_NAMES: Record<HomeSection, string> = {
  year: 'Итог года',
  stats: 'Статистика медиатеки',
  quick: 'Быстрый доступ',
  recent: 'Недавно добавлено',
  top: 'Чаще всего слушаете',
  playlists: 'Плейлисты'
}
const NAV_NAMES: [NavItem, string][] = [
  ['home', 'Главная'],
  ['downloads', 'Загрузки'],
  ['liked', 'Любимое'],
  ['tracks', 'Все треки'],
  ['albums', 'Альбомы'],
  ['artists', 'Исполнители'],
  ['playlists', 'Плейлисты']
]
const COLOR_NAMES: [keyof CustomColors, string, string][] = [
  ['bg', 'Фон окна', 'Под содержимым'],
  ['surface', 'Поверхности', 'Карточки, списки, панели'],
  ['text', 'Текст', 'Основной'],
  ['text2', 'Второстепенный текст', 'Подписи и время'],
  ['separator', 'Разделители', 'Линии в списках']
]

const pct = (v: number) => `${Math.round(v * 100)}%`




/** Миниатюра стиля: фон, боковая панель, строки и плеер в цветах стиля. */
function LookPreview({ look, base }: { look: Partial<AppearanceSettings>; base: AppearanceSettings }) {
  const a = { ...base, ...look }
  const th = THEMES.find((t) => t.id === a.theme) ?? THEMES[0]
  const [bg, surface, line] = th.swatch
  const floating = a.sidebarStyle === 'floating'
  const glass = a.glassStyle !== 'off'
  const r = Math.max(2, Math.round(a.radius * 0.4))
  const bgImg = a.background === 'gradient' || a.background === 'cover'
    ? `radial-gradient(80% 90% at 20% 10%, ${a.accent}66, transparent 70%), ${bg}`
    : bg
  return (
    <span className="look-prev" style={{ background: bgImg }} aria-hidden>
      <i className="lp-side" style={{ background: glass ? `${surface}cc` : surface, borderRadius: floating ? r : 0, margin: floating ? 0 : '-6px 0 -6px -6px', boxShadow: a.glassStyle === 'liquid' ? 'inset 0 1px 0 rgb(255 255 255 / .25)' : undefined }} />
      <span className="lp-body">
        <i className="lp-line" style={{ width: '55%', background: a.accent }} />
        <i className="lp-line" style={{ width: '85%', background: surface }} />
        <i className="lp-line" style={{ width: '70%', background: surface }} />
        <i className="lp-line" style={{ width: '40%', background: line }} />
      </span>
      <i className="lp-player" style={{ background: glass ? `${surface}d9` : surface, borderRadius: a.playerStyle === 'floating' ? 7 : 0, ...(a.playerStyle === 'docked' ? { left: '30%', right: 0, bottom: 0, height: 12 } : {}), boxShadow: a.glassStyle === 'liquid' ? 'inset 0 1px 0 rgb(255 255 255 / .3)' : undefined }} />
    </span>
  )
}

const matches = (look: Partial<AppearanceSettings>, ap: AppearanceSettings) =>
  Object.entries(look).every(([k, v]) => JSON.stringify(ap[k as keyof AppearanceSettings]) === JSON.stringify(v))

function Looks() {
  const ap = useSettings((s) => s.settings.appearance)
  const looks = useSettings((s) => s.settings.looks)
  const patch = useSettings((s) => s.patch)
  const toast = useUI((s) => s.toast)
  const openModal = useUI((s) => s.openModal)
  const fileRef = useRef<HTMLInputElement>(null)
  const apply = (look: Partial<AppearanceSettings>) => patch({ appearance: look })

  const save = () =>
    openModal({
      kind: 'prompt',
      title: 'Сохранить стиль',
      initial: `Мой стиль ${looks.length + 1}`,
      placeholder: 'Название стиля',
      confirmLabel: 'Сохранить',
      onSubmit: (name) => {
        const cur = useSettings.getState().settings
        const look: SavedLook = { id: `look-${Date.now().toString(36)}`, name: name.trim().slice(0, 60) || `Мой стиль ${cur.looks.length + 1}`, createdAt: Date.now(), appearance: pickLook(cur.appearance) }
        patch({ looks: [...cur.looks, look] })
        toast(`Стиль «${look.name}» сохранён`, 'success')
      }
    })
  const exportLook = (name: string, look: Partial<AppearanceSettings>) => {
    const blob = new Blob([JSON.stringify({ wave: 'look', version: 1, name, appearance: look }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name.replace(/[\\/:*?"<>|]+/g, '_') || 'wave-style'}.wave-style.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  const importLook = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as { name?: string; appearance?: Record<string, unknown> }
      const src = data.appearance ?? (data as Record<string, unknown>)
      const look: Record<string, unknown> = {}
      for (const k of LOOK_KEYS) if (k in src) look[k] = src[k]
      if (!Object.keys(look).length) throw new Error('empty')
      const name = String(data.name ?? f.name.replace(/\.(wave-style\.)?json$/i, '')).slice(0, 60)
      patch({ appearance: look as Partial<AppearanceSettings>, looks: [...looks, { id: `look-${Date.now().toString(36)}`, name, createdAt: Date.now(), appearance: look as Partial<AppearanceSettings> }] })
      toast(`Стиль «${name}» применён и добавлен в «Мои стили»`, 'success')
    } catch {
      toast('Не удалось прочитать файл стиля', 'error')
    }
  }

  return (
    <>
      <h3>Готовые стили</h3>
      <div className="look-grid">
        {PRESETS.map((p) => (
          <button key={p.id} className={`look-card ${matches(p.look, ap) ? 'on' : ''}`} onClick={() => apply(p.look)}>
            <LookPreview look={p.look} base={ap} />
            <b>{p.name}</b>
            <small>{p.desc}</small>
          </button>
        ))}
      </div>

      <h3>Мои стили</h3>
      {looks.length > 0 && (
        <div className="look-grid">
          {looks.map((l) => (
            <div key={l.id} className={`look-card ${matches(l.appearance, ap) ? 'on' : ''}`}>
              <button className="look-card-hit" onClick={() => apply(l.appearance)} aria-label={`Применить стиль «${l.name}»`} style={{ display: 'grid', gap: 8, textAlign: 'left' }}>
                <LookPreview look={l.appearance} base={ap} />
                <b>{l.name}</b>
              </button>
              <div className="btn-row" style={{ padding: '0 4px', gap: 6 }}>
                <button className="btn sm" onClick={() => exportLook(l.name, l.appearance)}><Upload size={14} /> Файл</button>
                <button className="btn sm" onClick={() => { patch({ looks: looks.map((x) => (x.id === l.id ? { ...x, appearance: pickLook(ap) } : x)) }); toast(`Стиль «${l.name}» обновлён`, 'success') }} title="Записать в этот стиль текущее оформление"><Save size={14} /></button>
              </div>
              <button
                className="look-del"
                onClick={() => openModal({ kind: 'confirm', title: 'Удалить стиль?', text: `«${l.name}» будет удалён из «Моих стилей». Текущее оформление не изменится.`, confirmLabel: 'Удалить', danger: true, onConfirm: () => patch({ looks: looks.filter((x) => x.id !== l.id) }) })}
                aria-label={`Удалить стиль «${l.name}»`}
                title="Удалить"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="btn-row" style={{ marginTop: looks.length ? 12 : 0 }}>
        <button className="btn tonal" onClick={save}><Save size={16} /> Сохранить текущее</button>
        <button className="btn" onClick={() => exportLook('Wave — мой стиль', pickLook(ap))}><Upload size={16} /> Экспорт в файл</button>
        <button className="btn" onClick={() => fileRef.current?.click()}><Download size={16} /> Импорт из файла</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importLook(f); e.target.value = '' }} />
      </div>
      <p className="ios-group-note">Стиль — это все настройки этого раздела, кроме файла фона. Файлом можно поделиться: его импортируют здесь же.</p>
    </>
  )
}

function Appearance() {
  const ap = useSettings((s) => s.settings.appearance)
  const patch = useSettings((s) => s.patch)
  const reload = useSettings((s) => s.reload)
  const navigate = useUI((s) => s.navigate)
  const openModal = useUI((s) => s.openModal)
  const set = (p: Partial<typeof ap>) => patch({ appearance: p })
  const th = THEMES.find((t) => t.id === ap.theme) ?? THEMES[0]

  const pickBg = async () => {
    const f = await window.wave.app.pickBackground()
    if (f) {
      await window.wave.settings.setBackgroundImage(f)
      await reload()
    }
  }
  const moveHome = (i: number, d: -1 | 1) => {
    const list = [...ap.home]
    const j = i + d
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    set({ home: list })
  }
  const css = getComputedStyle(document.documentElement)
  const themeColor = (v: string) => {
    const raw = css.getPropertyValue(v).trim()
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw : th.light ? '#ffffff' : '#1c1c1e'
  }

  return (
    <>
      <Looks />

      <h3>Тема</h3>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-card ${ap.theme === t.id ? 'on' : ''}`} onClick={() => set({ theme: t.id })}>
            <span className="swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 0 55%, ${t.swatch[1]} 55% 100%)` }}>
              <i style={{ background: t.swatch[2] }} />
            </span>
            <span>{t.name}</span>
            {ap.theme === t.id && <Check size={14} />}
          </button>
        ))}
      </div>

      <Group title="Акцентный цвет">
        <div className="ios-pad">
          <div className="accents">
            {ACCENTS.map((c) => (
              <button key={c} className={`dot ${ap.accent.toLowerCase() === c && !ap.accentFromCover ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ accent: c, accentFromCover: false })} aria-label={`Акцент ${c}`} />
            ))}
            <input type="color" value={ap.accent} onChange={(e) => set({ accent: e.target.value, accentFromCover: false })} aria-label="Свой цвет" title="Свой цвет" />
          </div>
        </div>
        <Row title="Цвет из обложки" desc="Акцент подстраивается под играющий трек"><Toggle label="Цвет из обложки" checked={ap.accentFromCover} onChange={(v) => set({ accentFromCover: v })} /></Row>
      </Group>

      <Group title="Свои цвета" note="Перекрывают цвета темы. Значок со стрелкой возвращает цвет темы.">
        {COLOR_NAMES.map(([k, label, desc]) => (
          <Row key={k} title={label} desc={desc}>
            <ColorField label={label} value={ap.colors[k]} fallback={themeColor(k === 'bg' ? '--bg' : k === 'surface' ? '--panel-solid' : k === 'text' ? '--fg' : k === 'text2' ? '--fg-2' : '--line')} onChange={(v) => set({ colors: { ...ap.colors, [k]: v } })} />
          </Row>
        ))}
      </Group>

      <Group title="Стекло" note={ap.glassStyle === 'liquid' ? 'Жидкое стекло: прозрачная подложка, светлый кант и блики. Преломление искажает фон под панелями и заметнее всего на фоне из обложки или фото; оно нагружает видеокарту.' : ap.glassStyle === 'frosted' ? 'Матовое стекло: размытие фона под панелями без бликов.' : 'Панели непрозрачные.'}>
        <Row title="Эффект стекла"><Seg value={ap.glassStyle} onChange={(v) => set({ glassStyle: v })} options={[['off', 'Выкл'], ['frosted', 'Матовое'], ['liquid', 'Жидкое']]} /></Row>
        {ap.glassStyle !== 'off' && (
          <>
            <Row title="Плотность" desc="Меньше — прозрачнее"><Range2 value={ap.glassOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ glassOpacity: v })} format={pct} /></Row>
            <Row title="Размытие"><Range2 value={ap.blur} min={0} max={80} step={1} onChange={(v) => set({ blur: v })} format={(v) => `${v} px`} /></Row>
            <Row title="Насыщенность" desc="Яркость цветов сквозь стекло"><Range2 value={ap.glassSaturation} min={1} max={3} step={0.05} onChange={(v) => set({ glassSaturation: v })} format={pct} /></Row>
            {ap.glassStyle === 'liquid' && <Row title="Блики и кант"><Range2 value={ap.glassHighlight} min={0} max={1} step={0.01} onChange={(v) => set({ glassHighlight: v })} format={pct} /></Row>}
            {ap.glassStyle === 'liquid' && <Row title="Преломление" desc="Фон под стеклом слегка искажается"><Toggle label="Преломление" checked={ap.glassRefraction} onChange={(v) => set({ glassRefraction: v })} /></Row>}
            <Row title="Оттенок стекла"><ColorField label="Оттенок стекла" value={ap.glassTint} fallback={themeColor('--panel-solid')} onChange={(v) => set({ glassTint: v })} /></Row>
          </>
        )}
      </Group>

      <Group title="Фон">
        <Row title="Фон приложения">
          <Seg value={ap.background} onChange={(v) => (v === 'image' && !ap.backgroundImage ? pickBg() : set({ background: v }))}
            options={[['solid', 'Однотонный'], ['cover', 'Обложка'], ['gradient', 'Градиент'], ['image', 'Фото / видео']]} />
        </Row>
        {ap.background === 'image' && (
          <Row title="Файл фона" desc="jpg, png, webp, gif, mp4, webm. Видео играет без звука, по кругу.">
            <div className="btn-row">
              <button className="btn sm" onClick={pickBg}>Выбрать файл…</button>
              {ap.backgroundImage && <button className="btn sm" onClick={async () => { await window.wave.settings.setBackgroundImage(null); await reload() }}><Trash2 size={14} /> Убрать</button>}
            </div>
          </Row>
        )}
        {ap.background !== 'solid' && <Row title="Затемнение фона"><Range2 value={ap.dim} min={0} max={0.95} step={0.01} onChange={(v) => set({ dim: v })} format={pct} /></Row>}
        {ap.background !== 'solid' && ap.glassStyle === 'off' && <Row title="Размытие фона"><Range2 value={ap.blur} min={0} max={80} step={1} onChange={(v) => set({ blur: v })} format={(v) => `${v} px`} /></Row>}
      </Group>

      <Group title="Раскладка">
        <Row title="Боковая панель"><Seg value={ap.sidebarStyle} onChange={(v) => set({ sidebarStyle: v })} options={[['floating', 'Плавающая'], ['docked', 'У края']]} /></Row>
        <Row title="Ширина боковой панели"><Range2 value={ap.sidebarWidth} min={220} max={360} step={2} onChange={(v) => set({ sidebarWidth: v })} format={(v) => `${v} px`} /></Row>
        <Row title="Плеер"><Seg value={ap.playerStyle} onChange={(v) => set({ playerStyle: v })} options={[['floating', 'Плавающий'], ['docked', 'Панель снизу']]} /></Row>
        <Row title="Поиск"><Seg value={ap.searchPlacement} onChange={(v) => set({ searchPlacement: v })} options={[['sidebar', 'В боковой панели'], ['toolbar', 'Сверху']]} /></Row>
      </Group>

      <Group title="Форма">
        <Row title="Скругление углов" desc="Панели, карточки, списки"><Range2 value={ap.radius} min={0} max={32} step={1} onChange={(v) => set({ radius: v })} format={(v) => `${v} px`} /></Row>
        <Row title="Скругление обложек"><Range2 value={ap.coverRadius} min={0} max={2.5} step={0.05} onChange={(v) => set({ coverRadius: v })} format={pct} /></Row>
        <Row title="Кнопки"><Seg value={ap.buttonShape} onChange={(v) => set({ buttonShape: v })} options={[['capsule', 'Капсулы'], ['rounded', 'Скруглённые'], ['square', 'Прямые']]} /></Row>
        <Row title="Тени"><Range2 value={ap.shadows} min={0} max={1} step={0.01} onChange={(v) => set({ shadows: v })} format={pct} /></Row>
        <Row title="Разделители в списках"><Toggle label="Разделители" checked={ap.separators} onChange={(v) => set({ separators: v })} /></Row>
      </Group>

      <Group title="Текст и иконки">
        <Row title="Шрифт">
          <select className="select" value={ap.font} onChange={(e) => set({ font: e.target.value as FontName })}>
            {FONTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Row>
        <Row title="Размер текста"><Range2 value={ap.fontScale} min={0.85} max={1.3} step={0.01} onChange={(v) => set({ fontScale: v })} format={pct} /></Row>
        <Row title="Крупные заголовки"><Range2 value={ap.titleSize} min={22} max={56} step={1} onChange={(v) => set({ titleSize: v })} format={(v) => `${v} px`} /></Row>
        <Row title="Насыщенность заголовков"><Range2 value={ap.titleWeight} min={400} max={900} step={100} onChange={(v) => set({ titleWeight: v })} format={(v) => String(v)} /></Row>
        <Row title="Толщина линий иконок"><Range2 value={ap.iconStroke} min={1} max={2.75} step={0.05} onChange={(v) => set({ iconStroke: v })} format={(v) => v.toFixed(2)} /></Row>
      </Group>

      <Group title="Масштаб и плотность">
        <Row title="Масштаб интерфейса" desc="Всё окно целиком"><Range2 value={ap.scale} min={0.8} max={1.3} step={0.01} onChange={(v) => set({ scale: v })} format={pct} /></Row>
        <Row title="Плотность списков"><Seg value={ap.density} onChange={(v) => set({ density: v })} options={[['compact', 'Компактно'], ['comfortable', 'Обычно'], ['roomy', 'Просторно']]} /></Row>
        <Row title="Размер карточек"><Range2 value={ap.cardSize} min={130} max={260} step={2} onChange={(v) => set({ cardSize: v })} format={(v) => `${v} px`} /></Row>
      </Group>

      <Group title="Главная" note="Стрелками меняется порядок, переключателем — показывать раздел или нет.">
        <div className="order-list">
          {ap.home.map((h, i) => (
            <div key={h.id} className={`order-row ${h.visible ? '' : 'off'}`}>
              <span className="name">{HOME_NAMES[h.id]}</span>
              <button className="icon-btn sm" disabled={i === 0} onClick={() => moveHome(i, -1)} aria-label={`${HOME_NAMES[h.id]}: выше`}><ArrowUp size={16} /></button>
              <button className="icon-btn sm" disabled={i === ap.home.length - 1} onClick={() => moveHome(i, 1)} aria-label={`${HOME_NAMES[h.id]}: ниже`}><ArrowDown size={16} /></button>
              <Toggle label={`Показывать «${HOME_NAMES[h.id]}»`} checked={h.visible} onChange={(v) => set({ home: ap.home.map((x) => (x.id === h.id ? { ...x, visible: v } : x)) })} />
            </div>
          ))}
        </div>
      </Group>

      <Group title="Боковая панель">
        {NAV_NAMES.map(([k, label]) => (
          <Row key={k} title={label}><Toggle label={`Показывать «${label}»`} checked={ap.nav[k]} onChange={(v) => set({ nav: { ...ap.nav, [k]: v } })} /></Row>
        ))}
      </Group>

      <Group title="Движение">
        <Row title="Анимации"><Toggle label="Анимации" checked={ap.animations} onChange={(v) => set({ animations: v })} /></Row>
        {ap.animations && <Row title="Скорость анимаций" desc="Больше — плавнее и медленнее"><Range2 value={ap.animSpeed} min={0.5} max={2} step={0.05} onChange={(v) => set({ animSpeed: v })} format={(v) => `×${v.toFixed(2)}`} /></Row>}
      </Group>

      <Group title="Плеер">
        <Row title="Полоса перемотки" desc="«Форма трека» считается при первом проигрывании"><Seg value={ap.seekStyle} onChange={(v) => set({ seekStyle: v })} options={[['line', 'Линия'], ['squiggly', 'Волнистая'], ['waveform', 'Форма трека']]} /></Row>
        <Row title="Визуализатор" desc="Спектр в режиме «Сейчас играет»"><Toggle label="Визуализатор" checked={ap.showVisualizer} onChange={(v) => set({ showVisualizer: v })} /></Row>
      </Group>

      <Group title="Караоке">
        <Row title="Размер текста"><Range2 value={ap.lyricsSize} min={20} max={64} step={1} onChange={(v) => set({ lyricsSize: v })} format={(v) => `${v} px`} /></Row>
        <Row title="Выравнивание"><Seg value={ap.lyricsAlign} onChange={(v) => set({ lyricsAlign: v })} options={[['left', 'Слева'], ['center', 'По центру']]} /></Row>
        <Row title="Плавная заливка слов" desc="Строка закрашивается по мере пения"><Toggle label="Заливка" checked={ap.lyricsWordSweep} onChange={(v) => set({ lyricsWordSweep: v })} /></Row>
        <Row title="Размывать далёкие строки"><Toggle label="Размытие" checked={ap.lyricsBlurFar} onChange={(v) => set({ lyricsBlurFar: v })} /></Row>
      </Group>

      <Group title="Ещё глубже" note="Свой CSS применяется поверх всего оформления сразу; все параметры доступны как переменные: --accent, --radius, --glass-op, --blur, --fs и другие.">
        <Row title="Свой CSS и плагины"><button className="btn sm" onClick={() => navigate({ name: 'settings', tab: 'extensions' })}>Открыть</button></Row>
        <Row title="Сбросить оформление" desc="Вернуть iOS-стиль по умолчанию. «Мои стили» сохранятся.">
          <button className="btn sm danger" onClick={() => openModal({ kind: 'confirm', title: 'Сбросить оформление?', text: 'Все настройки этого раздела вернутся к значениям по умолчанию. Сохранённые стили останутся.', confirmLabel: 'Сбросить', danger: true, onConfirm: () => set(DEFAULT_APPEARANCE()) })}>Сбросить</button>
        </Row>
      </Group>
    </>
  )
}

function AlignRow() {
  const align = useLyrics((s) => s.align)
  const byTrack = useLibrary((s) => s.byId)
  if (!align) return null
  const cur = align.current ? byTrack[align.current] : undefined
  const model =
    align.model === 'ready' ? 'Модель готова.' :
    align.model === 'downloading' ? `Скачиваю модель — ${Math.round((align.progress ?? 0) * 100)}%.` :
    align.model === 'error' ? `Не удалось скачать модель: ${align.error ?? 'ошибка'}. Попробую снова позже.` :
    'Модель скачается, когда понадобится.'
  const work = cur
    ? `Сейчас: «${cur.title}» — ${Math.round((align.currentProgress ?? 0) * 100)}%.${align.queue ? ` В очереди ещё ${align.queue}.` : ''}`
    : align.queue
      ? `В очереди: ${align.queue}.`
      : 'Очередь пуста.'
  return (
    <Row title="Синхронизация по звуку" desc={`${model} ${work}${align.done ? ` Готово за сеанс: ${align.done}.` : ''}`}>
      <button className="btn sm" onClick={() => void window.wave.align.library()}>Синхронизировать всю медиатеку</button>
    </Row>
  )
}

function AudioTab() {
  const au = useSettings((s) => s.settings.audio)
  const patch = useSettings((s) => s.patch)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audiooutput'))).catch(() => {})
  }, [])
  return (
    <>
      <h3>Вывод</h3>
      <Row title="Устройство вывода" desc="Куда играть звук">
        <select className="select" value={au.outputDeviceId} onChange={(e) => patch({ audio: { outputDeviceId: e.target.value } })}>
          <option value="default">Системное по умолчанию</option>
          {devices.filter((d) => d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
        </select>
      </Row>
      <h3>Громкость</h3>
      <Row title="Выравнивание громкости" desc="Каждый трек измеряется при загрузке (EBU R128) и подтягивается к одному уровню — без пересжатия звука">
        <Toggle label="Нормализация" checked={au.normalize} onChange={(v) => patch({ audio: { normalize: v } })} />
      </Row>
      {au.normalize && (
        <Row title="Целевая громкость" desc="−14 LUFS — как у Spotify и YouTube"><Range value={au.targetLufs} min={-24} max={-8} step={1} onChange={(v) => patch({ audio: { targetLufs: v } })} suffix=" LUFS" /></Row>
      )}
      <h3>Переходы между треками</h3>
      <Row title="Кроссфейд" desc="Конец трека плавно перетекает в начало следующего. 0 — выключен">
        <Range value={au.crossfade} min={0} max={12} step={1} onChange={(v) => patch({ audio: { crossfade: v } })} suffix=" с" />
      </Row>
      {au.crossfade === 0 && (
        <Row title="Без пауз (gapless)" desc="Следующий трек запускается сразу, без тишины между ними — полезно для концертных и сведённых альбомов">
          <Toggle label="Gapless" checked={au.gapless} onChange={(v) => patch({ audio: { gapless: v } })} />
        </Row>
      )}
      <h3>Эквалайзер</h3>
      <div className="eq-embed"><EqPanel /></div>
      <h3>Эффекты</h3>
      <div className="eq-embed"><FxPanel /></div>
      <p className="hint">Для лучшего звука держите эквалайзер и эффекты выключенными: тогда плеер не обрабатывает аудио, а отдаёт его системе как есть.</p>
    </>
  )
}

const BROWSERS: [BrowserName, string][] = [['none', 'Не использовать'], ['firefox', 'Firefox'], ['chrome', 'Chrome'], ['chromium', 'Chromium'], ['brave', 'Brave'], ['edge', 'Edge'], ['vivaldi', 'Vivaldi'], ['opera', 'Opera']]

function DownloadsTab() {
  const dl = useSettings((s) => s.settings.download)
  const patch = useSettings((s) => s.patch)
  const tools = useDownloads((s) => s.tools)
  const toast = useUI((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<typeof dl>) => patch({ download: p })

  const loginYandex = async () => {
    setBusy(true)
    try {
      const token = await window.wave.tools.yandexLogin()
      if (token) {
        set({ yandexToken: token })
        toast('Вход в Яндекс выполнен', 'success')
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h3>Хранилище</h3>
      <Row title="Папка с музыкой" desc={dl.musicDir}>
        <button className="btn" onClick={async () => { const p = await window.wave.app.pickFolder(); if (p) set({ musicDir: p }) }}><FolderOpen size={15} /> Выбрать…</button>
      </Row>
      <Row title="Одновременных загрузок"><Range value={dl.concurrency} min={1} max={6} step={1} onChange={(v) => set({ concurrency: v })} /></Row>

      <h3>Качество звука</h3>
      <Row title="Куки браузера" desc="Если вы вошли в YouTube Premium или SoundCloud Go+ в этом браузере, Wave скачает аудио в повышенном качестве. Закройте браузер, если куки не читаются.">
        <select className="select" value={dl.cookiesFromBrowser} onChange={(e) => set({ cookiesFromBrowser: e.target.value as BrowserName })}>
          {BROWSERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Row>
      <Row title="Прокси" desc="Например socks5://127.0.0.1:1080 (необязательно)">
        <input className="input" value={dl.proxy} onChange={(e) => set({ proxy: e.target.value })} placeholder="не используется" spellCheck={false} />
      </Row>

      <h3>Яндекс Музыка</h3>
      <Row title="Аккаунт" desc={dl.yandexToken ? 'Вход выполнен: треки скачиваются из Яндекса в исходном качестве (с Plus — до FLAC)' : 'Без входа треки Яндекса ищутся на YouTube Music'} wide>
        <div className="btn-row">
          <button className="btn primary" onClick={loginYandex} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />} {dl.yandexToken ? 'Войти заново' : 'Войти через Яндекс'}</button>
          {dl.yandexToken && <button className="btn" onClick={() => set({ yandexToken: '' })}>Выйти</button>}
        </div>
      </Row>
      <Row title="OAuth-токен" desc="Заполняется автоматически при входе; можно вставить вручную"><input className="input" type="password" value={dl.yandexToken} onChange={(e) => set({ yandexToken: e.target.value.trim() })} placeholder="y0_…" spellCheck={false} /></Row>

      <h3>Тексты</h3>
      <Row title="Искать тексты автоматически" desc="После загрузки: .lrc рядом с файлом → Яндекс → LRCLIB (с таймингами для караоке) → Genius"><Toggle label="Авто" checked={dl.autoLyrics} onChange={(v) => set({ autoLyrics: v })} /></Row>
      <Row
        title="Синхронизировать текст по звуку"
        desc="Если готовых таймингов нет (часто у треков с SoundCloud), Wave сам выравнивает найденный текст по песне локальной моделью: время каждой строки и слова. Работает в фоне и без интернета; модель (~1,3 ГБ) скачивается один раз."
      >
        <Toggle label="Синхронизировать по звуку" checked={dl.alignLyrics} onChange={(v) => set({ alignLyrics: v })} />
      </Row>
      {dl.alignLyrics && <AlignRow />}
      <Row title="Сохранять .lrc рядом с файлом" desc="Чтобы караоке работало и в других плеерах"><Toggle label="LRC" checked={dl.saveLrcFile} onChange={(v) => set({ saveLrcFile: v })} /></Row>
      <Row title="Токен Genius API" desc={<>Нужен только для поиска нужной страницы на Genius. Сами тексты Genius защищает от программ и может не отдать — тогда приложение подскажет, как открыть страницу и вставить текст вручную. Клиент создаётся бесплатно на <a href="#" onClick={(e) => { e.preventDefault(); window.wave.app.openExternal('https://genius.com/api-clients') }}>genius.com/api-clients</a> («Client Access Token»).</>}>
        <input className="input" type="password" value={dl.geniusToken} onChange={(e) => set({ geniusToken: e.target.value.trim() })} placeholder="не задан" spellCheck={false} />
      </Row>

      <h3>Инструменты</h3>
      <Row title="yt-dlp" desc={tools?.ytdlp.state === 'ready' ? `Версия ${tools.ytdlp.version}` : tools?.ytdlp.state === 'downloading' ? `Загрузка ${Math.round(tools.ytdlp.progress * 100)}%` : tools?.ytdlp.state === 'error' ? tools.ytdlp.message : 'Не установлен'}>
        <div className="btn-row">
          <button className="btn" onClick={async () => { setBusy(true); try { await window.wave.tools.updateYtDlp(); toast('yt-dlp обновлён', 'success') } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) } }} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''} /> Обновить</button>
        </div>
      </Row>
      <Row title="Автообновление yt-dlp" desc="YouTube часто меняется — свежий yt-dlp важен"><Toggle label="Автообновление" checked={dl.autoUpdateYtDlp} onChange={(v) => set({ autoUpdateYtDlp: v })} /></Row>
      <Row title="ffmpeg" desc={tools?.ffmpeg.state === 'ready' ? tools.ffmpeg.path : tools?.ffmpeg.state === 'error' ? tools.ffmpeg.message : '…'}><span /></Row>
      <Row title="JS-рантайм для YouTube" desc={tools?.jsRuntime ?? '—'}><span /></Row>
    </>
  )
}

function LibraryTab() {
  const tracks = useLibrary((s) => s.tracks)
  const toast = useUI((s) => s.toast)
  const missing = tracks.filter((t) => t.missing).length
  const importPaths = async (paths: string[]) => {
    if (!paths.length) return
    toast('Импортирую…')
    const n = await window.wave.library.importLocal(paths)
    toast(n ? `Добавлено треков: ${n}` : 'Новых файлов не найдено', n ? 'success' : 'info')
  }
  return (
    <>
      <h3>Свои файлы</h3>
      <Row title="Добавить файлы с компьютера" desc="Аудиофайлы остаются на месте — Wave просто добавляет их в библиотеку. Из видео (mp4, mkv, mov…) вытаскивается звук и сохраняется в папку музыки. Можно также перетащить файлы в окно.">
        <div className="btn-row">
          <button className="btn" onClick={async () => importPaths(await window.wave.app.pickAudio())}>Выбрать файлы…</button>
          <button className="btn" onClick={async () => { const p = await window.wave.app.pickFolder(); if (p) await importPaths([p]) }}>Выбрать папку…</button>
        </div>
      </Row>
      <h3>Состояние</h3>
      <Row title="Треков в библиотеке"><strong>{tracks.length}</strong></Row>
      {missing > 0 && (
        <Row title="Файлы не найдены" desc="Эти треки перемещены или удалены с диска">
          <button className="btn danger-text" onClick={() => window.wave.library.remove(tracks.filter((t) => t.missing).map((t) => t.id), false)}>Убрать {missing} из библиотеки</button>
        </Row>
      )}
    </>
  )
}

function AccountTab() {
  const toast = useUI((s) => s.toast)
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [server, setServer] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.wave.sync.status().then((s) => { setSt(s); if (s.server) setServer(s.server) })
    return window.wave.on('sync:status', setSt)
  }, [])
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast(ok, 'success')
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
    } finally {
      setBusy(false)
    }
  }
  const signIn = (mode: 'login' | 'register') => run(async () => { await window.wave.sync.signIn(mode, server, user, pass); setPass('') }, mode === 'login' ? 'Вход выполнен' : 'Аккаунт создан')
  if (!st) return null

  if (st.signedIn) {
    return (
      <>
        <h3>Аккаунт Wave</h3>
        <Row title={st.username ?? ''} desc={st.server}>
          <button className="btn" disabled={busy} onClick={() => run(() => window.wave.sync.signOut(), 'Вы вышли из аккаунта')}><LogIn size={15} /> Выйти</button>
        </Row>
        <h3>Синхронизация</h3>
        <Row title="Автоматически" desc="Библиотека, плейлисты, «любимое» и настройки синхронизируются в фоне. Аудиофайлы между устройствами не передаются.">
          <Toggle label="Автосинхронизация" checked={st.auto} onChange={(v) => run(() => window.wave.sync.setAuto(v))} />
        </Row>
        <Row title="Синхронизировать сейчас" desc={st.error ? <span className="err-text">{st.error}</span> : st.lastSync ? `Последний раз: ${new Date(st.lastSync).toLocaleString()}` : 'Ещё не выполнялась'}>
          <button className="btn" disabled={busy || st.syncing} onClick={() => run(() => window.wave.sync.now(), 'Синхронизировано')}>
            {st.syncing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Синхронизировать
          </button>
        </Row>
        {st.pending > 0 && (
          <Row title={`Треков с других устройств: ${st.pending}`} desc="Их нет на этом устройстве. Wave скачает их заново по исходным ссылкам.">
            <button className="btn primary" disabled={busy} onClick={() => run(async () => { const n = await window.wave.sync.downloadMissing(); toast(`Поставлено в загрузку: ${n}`, 'success') })}>Скачать недостающие</button>
          </Row>
        )}
        <p className="hint wide">Что синхронизируется: список треков и их источники, плейлисты, лайки, счётчик прослушиваний, оформление, настройки звука, свой CSS. Не синхронизируются: токены (Яндекс, Genius), папка музыки, фоновое фото, громкость, устройство вывода, включённые плагины.</p>
      </>
    )
  }

  return (
    <>
      <h3>Аккаунт Wave</h3>
      <p className="hint wide">
        Чтобы синхронизировать библиотеку между устройствами, нужен сервер синхронизации. Свой сервер запускается одной командой:{' '}
        <code>node server/server.mjs</code> (см. README). Данные хранятся только у вас.
      </p>
      <Row title="Адрес сервера" desc="Например: http://127.0.0.1:8787 или https://sync.example.com">
        <input className="input" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://sync.example.com" spellCheck={false} />
      </Row>
      <Row title="Имя пользователя" desc="3–32 символа: латиница, цифры, _ . -">
        <input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" spellCheck={false} />
      </Row>
      <Row title="Пароль" desc="Не короче 8 символов">
        <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && server && user && pass && signIn('login')} />
      </Row>
      <div className="btn-row">
        <button className="btn primary" disabled={busy || !server || !user || !pass} onClick={() => signIn('login')}>{busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />} Войти</button>
        <button className="btn" disabled={busy || !server || !user || !pass} onClick={() => signIn('register')}>Создать аккаунт</button>
      </div>
    </>
  )
}

function ExtensionsTab() {
  const ext = useSettings((s) => s.settings.extensions)
  const patch = useSettings((s) => s.patch)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [css, setCss] = useState(ext.customCss)
  const refresh = () => window.wave.plugins.list().then(setPlugins)
  useEffect(() => { void refresh() }, [ext.enabledPlugins])
  // CSS применяется «вживую», но в настройки пишем с небольшой задержкой
  useEffect(() => {
    if (css === ext.customCss) return
    const t = setTimeout(() => patch({ extensions: { customCss: css } }), 400)
    return () => clearTimeout(t)
  }, [css])
  const toggle = (id: string, on: boolean) =>
    patch({ extensions: { enabledPlugins: on ? [...new Set([...ext.enabledPlugins, id])] : ext.enabledPlugins.filter((x) => x !== id) } })

  return (
    <>
      <h3>Свой CSS</h3>
      <p className="hint wide">Стили применяются поверх темы сразу. Можно менять переменные (<code>--accent</code>, <code>--bg</code>, <code>--radius</code>…) и любые классы интерфейса.</p>
      <textarea
        className="css-editor"
        spellCheck={false}
        value={css}
        placeholder={':root {\n  --accent: #ff4d8d;\n}\n.playerbar { backdrop-filter: blur(30px); }'}
        onChange={(e) => setCss(e.target.value)}
      />
      <div className="btn-row">
        <button className="btn" onClick={() => setCss('')} disabled={!css}><Trash2 size={15} /> Очистить</button>
      </div>

      <h3>Плагины</h3>
      <Row title="Папка плагинов" desc="Каждый плагин — папка с index.js и/или style.css (и необязательным plugin.json: name, version, author, description)">
        <div className="btn-row">
          <button className="btn" onClick={() => window.wave.plugins.openFolder()}><FolderOpen size={15} /> Открыть</button>
          <button className="btn" onClick={() => void refresh()}><RefreshCw size={15} /> Обновить</button>
          <button className="btn" onClick={() => location.reload()}>Перезагрузить окно</button>
        </div>
      </Row>
      <p className="hint wide">
        Плагин — это код, который выполняется внутри Wave и получает доступ к вашей библиотеке и настройкам. Включайте только те плагины,
        которым доверяете. Все плагины по умолчанию выключены.
      </p>
      {plugins.length === 0 && <p className="muted">Плагинов пока нет.</p>}
      {plugins.map((p) => (
        <Row key={p.id} title={`${p.name}${p.version ? ` ${p.version}` : ''}`} desc={[p.description, p.author && `Автор: ${p.author}`, p.hasJs && 'JS', p.hasCss && 'CSS'].filter(Boolean).join(' · ')}>
          <Toggle label={p.name} checked={p.enabled} onChange={(v) => toggle(p.id, v)} />
        </Row>
      ))}
      <Row title="API для плагинов" wide>
        <pre className="code">{`// index.js — плагин получает Wave (= window.WaveAPI)
Wave.player.getState()        // { currentId, playing, duration, shuffle, repeat, queue }
Wave.player.subscribe(cb)     // cb(state) при любом изменении; возвращает отписку
Wave.player.toggle() / next() / prev() / seek(сек) / play([id…])
Wave.library.getTracks() / getTrack(id)
Wave.ui.toast('текст', 'info' | 'success' | 'error')
Wave.settings.get() / patch({ … })
Wave.css('.playerbar { … }')  // вернёт функцию удаления стилей`}</pre>
      </Row>

      <DiscordSection />
    </>
  )
}

function DiscordSection() {
  const dc = useSettings((s) => s.settings.integrations.discord)
  const patch = useSettings((s) => s.patch)
  const [id, setId] = useState(dc.clientId)
  const [st, setSt] = useState<PresenceStatus | null>(null)
  useEffect(() => {
    let alive = true
    const tick = () => window.wave.presence.status().then((s) => alive && setSt(s)).catch(() => {})
    tick()
    const t = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  const valid = /^\d{15,25}$/.test(id.trim())
  const state = !dc.enabled ? 'выключено' : !st?.configured ? 'нужен Application ID' : st.connected ? 'подключено к Discord' : st.error ?? 'подключаюсь…'
  return (
    <>
      <h3>Discord</h3>
      <p className="hint wide">
        Показывает в профиле Discord, что вы слушаете (название, исполнитель, время). Данные уходят только в локально запущенный клиент Discord.
        Нужен собственный Application ID: создайте приложение на discord.com/developers/applications (его название и увидят друзья, например «Wave») и вставьте ID сюда.
      </p>
      <Row title="Application ID" desc="15–25 цифр со страницы приложения в Discord Developer Portal">
        <div className="btn-row">
          <input className="input" style={{ width: 240 }} inputMode="numeric" placeholder="1234567890123456789" value={id} onChange={(e) => setId(e.target.value)} />
          <button className="btn" disabled={!valid || id.trim() === dc.clientId} onClick={() => patch({ integrations: { discord: { clientId: id.trim() } } })}>Сохранить</button>
        </div>
      </Row>
      <Row title="Показывать, что я слушаю" desc={`Статус: ${state}`}>
        <Toggle label="Discord" checked={dc.enabled} onChange={(v) => patch({ integrations: { discord: { enabled: v } } })} />
      </Row>
    </>
  )
}

function About() {
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null)
  useEffect(() => { window.wave.app.info().then(setInfo) }, [])
  return (
    <>
      <h3>Wave {info?.version}</h3>
      <p className="muted about">
        Личный плеер для домашней коллекции. Приложение некоммерческое и сделано для личного удобства: загружайте только то,
        что вы вправе сохранять, и соблюдайте условия сервисов-источников.
      </p>
      <Row title="Данные приложения" desc={info?.dataDir}>
        <button className="btn" onClick={() => info && window.wave.app.showInFolder(info.dataDir)}><ExternalLink size={15} /> Открыть</button>
      </Row>
      <Row title="Горячие клавиши" wide>
        <ul className="keys">
          <li><kbd>Пробел</kbd> играть / пауза</li>
          <li><kbd>Ctrl</kbd>+<kbd>←</kbd>/<kbd>→</kbd> предыдущий / следующий</li>
          <li><kbd>Ctrl</kbd>+<kbd>K</kbd> поиск</li>
          <li><kbd>Ctrl</kbd>+<kbd>V</kbd> вставить ссылку</li>
          <li><kbd>L</kbd> караоке</li>
          <li><kbd>Q</kbd> очередь</li>
          <li><kbd>Esc</kbd> закрыть окно</li>
        </ul>
      </Row>
    </>
  )
}
