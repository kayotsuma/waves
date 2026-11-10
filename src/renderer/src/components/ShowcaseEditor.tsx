import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Eye, EyeOff, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { BLOCK_INFO, BLOCK_KINDS, defaultProfile, newBlock, PERIOD_NAMES, STAT_INFO, STAT_KEYS } from '@shared/profile'
import type { Profile, ProfileEffect, ShowcaseBlock, ShowcaseBlockKind, ShowcaseLayout, StatKey } from '@shared/types'
import { groupAlbums, groupArtists, normalizeQuery } from '@/lib/collections'
import { coverUrl } from '@/lib/format'
import { BADGE_NAMES, yearsAvailable } from '@/lib/stats'
import { FONTS } from '@/lib/themes'
import { useLibrary } from '@/store/library'
import { useProfile } from '@/store/profile'
import { useUI } from '@/store/ui'
import { ColorField, Range2, Seg, Toggle } from './Form'
import { Icon, blockTitle } from './Showcase'

type Tab = 'profile' | 'look' | 'blocks' | 'access'

const PALETTES: [string, string, string][] = [
  ['Сумерки', '#6a5af9', '#ff5c8a'],
  ['Океан', '#0077ff', '#00d4c8'],
  ['Закат', '#ff7a18', '#af002d'],
  ['Мята', '#38ef7d', '#11998e'],
  ['Неон', '#f72585', '#4cc9f0'],
  ['Лаванда', '#c3aed6', '#8b5cf6'],
  ['Персик', '#ffb199', '#ff0844'],
  ['Золото', '#f7971e', '#ffd200'],
  ['Лёд', '#e0eafc', '#a1c4fd'],
  ['Лес', '#134e5e', '#71b280'],
  ['Ночь', '#0f0c29', '#302b63'],
  ['Графит', '#3a3a40', '#16161a']
]

const EFFECTS: [ProfileEffect, string][] = [
  ['none', 'Нет'],
  ['aurora', 'Сияние'],
  ['bokeh', 'Боке'],
  ['stars', 'Звёзды'],
  ['snow', 'Снег'],
  ['waves', 'Волны'],
  ['grain', 'Плёнка']
]

const EMOJI = ['🎧', '🎵', '🔥', '💜', '🌙', '☕', '🎸', '🎹', '🎤', '🌊', '✨', '😴', '🖤', '🚀', '🌸', '🎮']

const TEMPLATES: { id: string; name: string; desc: string; blocks: () => ShowcaseBlock[] }[] = [
  { id: 'classic', name: 'Классика', desc: 'Сейчас играет, статистика, топы, значки', blocks: () => defaultProfile().blocks },
  {
    id: 'stats',
    name: 'Статистик',
    desc: 'Всё в цифрах и графиках',
    blocks: () => [
      newBlock('stats', { items: ['minutes', 'plays', 'tracks', 'artists', 'streak', 'days', 'topHour', 'since'] }),
      newBlock('tracks', { layout: 'podium', period: 'year' }),
      newBlock('artists', { size: 'full', period: 'year' }),
      newBlock('clock'),
      newBlock('badges'),
      newBlock('activity')
    ]
  },
  {
    id: 'minimal',
    name: 'Минимал',
    desc: 'О себе, один трек и короткий топ',
    blocks: () => [newBlock('text', { size: 'full', title: 'Обо мне' }), newBlock('track'), newBlock('tracks', { size: 'half', count: 5 })]
  },
  {
    id: 'fan',
    name: 'Меломан',
    desc: 'Любимое крупно, цитата и ссылки',
    blocks: () => [
      newBlock('nowPlaying', { size: 'full' }),
      newBlock('track', { title: 'Мой гимн' }),
      newBlock('quote'),
      newBlock('artists', { size: 'full', layout: 'row', mode: 'auto' }),
      newBlock('albums', { size: 'full', layout: 'grid', count: 6 }),
      newBlock('links')
    ]
  }
]

const LAYOUT_NAMES: [ShowcaseLayout, string][] = [
  ['list', 'Список'],
  ['grid', 'Плитка'],
  ['podium', 'Пьедестал'],
  ['row', 'Лента']
]

// ───── выбор треков, исполнителей, альбомов ─────

type PickKind = 'track' | 'artist' | 'album'

function usePickSource(kind: PickKind) {
  const tracks = useLibrary((s) => s.tracks)
  return useMemo(() => {
    if (kind === 'track') return tracks.map((t) => ({ id: t.id, title: t.title, sub: t.artist, cover: coverUrl(t), hay: normalizeQuery(`${t.title} ${t.artist}`), rank: t.plays }))
    if (kind === 'artist') return groupArtists(tracks).map((g) => ({ id: g.key, title: g.title, sub: `${g.tracks.length} тр.`, cover: coverUrl(g.tracks.find((t) => t.hasCover)), hay: normalizeQuery(g.title), rank: g.tracks.reduce((s, t) => s + t.plays, 0) }))
    return groupAlbums(tracks).map((g) => ({ id: g.key, title: g.title, sub: g.subtitle, cover: coverUrl(g.tracks.find((t) => t.hasCover)), hay: normalizeQuery(`${g.title} ${g.subtitle}`), rank: g.tracks.reduce((s, t) => s + t.plays, 0) }))
  }, [tracks, kind])
}

export function ItemPicker({ kind, value, onChange, single, max = 12 }: { kind: PickKind; value: string[]; onChange: (v: string[]) => void; single?: boolean; max?: number }) {
  const src = usePickSource(kind)
  const [q, setQ] = useState('')
  const byId = useMemo(() => new Map(src.map((x) => [x.id, x])), [src])
  const results = useMemo(() => {
    const words = normalizeQuery(q.trim()).split(/\s+/).filter(Boolean)
    const list = words.length ? src.filter((x) => words.every((w) => x.hay.includes(w))) : [...src].sort((a, b) => b.rank - a.rank)
    return list.filter((x) => !value.includes(x.id)).slice(0, 8)
  }, [q, src, value])
  const move = (i: number, d: number) => {
    const next = [...value]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const ph = kind === 'track' ? 'Найти трек' : kind === 'artist' ? 'Найти исполнителя' : 'Найти альбом'
  return (
    <div className="pk">
      {!!value.length && (
        <div className="pk-sel">
          {value.map((id, i) => {
            const x = byId.get(id)
            return (
              <div key={id} className="pk-item">
                {x?.cover ? <img src={x.cover} alt="" className={kind === 'artist' ? 'round' : ''} /> : <span className="pk-fb" />}
                <span className="pk-t"><strong>{x?.title ?? id}</strong>{x?.sub && <small>{x.sub}</small>}</span>
                {!single && (
                  <>
                    <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Выше"><ArrowUp size={14} /></button>
                    <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === value.length - 1} aria-label="Ниже"><ArrowDown size={14} /></button>
                  </>
                )}
                <button className="icon-btn sm" onClick={() => onChange(value.filter((v) => v !== id))} aria-label="Убрать"><X size={14} /></button>
              </div>
            )
          })}
        </div>
      )}
      {(single ? !value.length : value.length < max) && (
        <>
          <input className="input pk-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ph} spellCheck={false} />
          <div className="pk-res">
            {results.map((x) => (
              <button key={x.id} className="pk-item add" onClick={() => { onChange(single ? [x.id] : [...value, x.id]); setQ('') }}>
                {x.cover ? <img src={x.cover} alt="" className={kind === 'artist' ? 'round' : ''} /> : <span className="pk-fb" />}
                <span className="pk-t"><strong>{x.title}</strong>{x.sub && <small>{x.sub}</small>}</span>
                <Plus size={15} />
              </button>
            ))}
            {!results.length && <p className="pk-none">Ничего не найдено</p>}
          </div>
        </>
      )}
    </div>
  )
}

// ───── настройки одного блока ─────

function Field({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="ed-field">
      <span className="ed-label">{label}</span>
      {children}
      {note && <span className="ed-note">{note}</span>}
    </div>
  )
}

function BlockOptions({ b, set }: { b: ShowcaseBlock; set: (fn: (b: ShowcaseBlock) => void) => void }) {
  const playlists = useLibrary((s) => s.playlists)
  const tracks = useLibrary((s) => s.tracks)
  const info = useProfile((s) => s.info)
  const years = useProfile((s) => s.years)
  const isTop = b.kind === 'tracks' || b.kind === 'artists' || b.kind === 'albums'
  const pick: PickKind = b.kind === 'artists' ? 'artist' : b.kind === 'albums' ? 'album' : 'track'
  const yrs = useMemo(() => yearsAvailable({ info, years }, tracks), [info, years, tracks])

  return (
    <div className="ed-block-opts">
      <Field label="Заголовок">
        <input className="input" value={b.title} placeholder={BLOCK_INFO[b.kind].title} onChange={(e) => set((x) => void (x.title = e.target.value))} maxLength={60} />
      </Field>
      <Field label="Ширина">
        <Seg value={b.size} options={[['half', 'Половина'], ['full', 'Во всю ширину']]} onChange={(v) => set((x) => void (x.size = v))} />
      </Field>

      {isTop && (
        <>
          <Field label="Что показывать">
            <Seg value={b.mode} options={[['auto', 'Топ по прослушиваниям'], ['manual', 'Свой выбор']]} onChange={(v) => set((x) => void (x.mode = v))} />
          </Field>
          {b.mode === 'auto' ? (
            <Field label="За период">
              <Seg value={b.period} options={PERIOD_NAMES} onChange={(v) => set((x) => void (x.period = v))} />
            </Field>
          ) : (
            <Field label={b.kind === 'tracks' ? 'Треки' : b.kind === 'artists' ? 'Исполнители' : 'Альбомы'}>
              <ItemPicker kind={pick} value={b.items} onChange={(v) => set((x) => void (x.items = v))} />
            </Field>
          )}
          <Field label="Вид">
            <Seg value={b.layout} options={LAYOUT_NAMES} onChange={(v) => set((x) => void (x.layout = v))} />
          </Field>
          <Field label={`Сколько: ${b.count}`}>
            <Range2 value={b.count} min={1} max={12} step={1} onChange={(v) => set((x) => void (x.count = v))} format={(v) => String(v)} />
          </Field>
        </>
      )}

      {b.kind === 'stats' && (
        <>
          <Field label="За период">
            <Seg value={b.period} options={PERIOD_NAMES} onChange={(v) => set((x) => void (x.period = v))} />
          </Field>
          <Field label="Показатели" note="Порядок — в каком нажимали">
            <div className="ed-chips">
              {STAT_KEYS.map((k) => {
                const on = b.items.includes(k)
                return (
                  <button key={k} className={`ed-chip ${on ? 'on' : ''}`} onClick={() => set((x) => void (x.items = on ? x.items.filter((i) => i !== k) : [...x.items, k as StatKey]))}>
                    {on && <Check size={13} />} {STAT_INFO[k]}
                  </button>
                )
              })}
            </div>
          </Field>
        </>
      )}

      {b.kind === 'clock' && (
        <Field label="За период">
          <Seg value={b.period} options={PERIOD_NAMES} onChange={(v) => set((x) => void (x.period = v))} />
        </Field>
      )}

      {(b.kind === 'track' || b.kind === 'quote') && (
        <Field label={b.kind === 'quote' ? 'Из какой песни' : 'Трек'}>
          <ItemPicker kind="track" single value={b.ref ? [b.ref] : []} onChange={(v) => set((x) => void (x.ref = v[0] ?? ''))} />
        </Field>
      )}
      {b.kind === 'track' && (
        <Field label="Подпись">
          <textarea className="input ed-area" rows={2} value={b.text} maxLength={400} placeholder="Почему именно он" onChange={(e) => set((x) => void (x.text = e.target.value))} />
        </Field>
      )}
      {b.kind === 'quote' && (
        <Field label="Строчка">
          <textarea className="input ed-area" rows={3} value={b.text} maxLength={400} placeholder="Строчка из песни" onChange={(e) => set((x) => void (x.text = e.target.value))} />
        </Field>
      )}
      {b.kind === 'text' && (
        <Field label="Текст">
          <textarea className="input ed-area" rows={6} value={b.text} maxLength={2000} placeholder="Что угодно о себе и своей музыке" onChange={(e) => set((x) => void (x.text = e.target.value))} />
        </Field>
      )}

      {b.kind === 'playlist' && (
        <>
          <Field label="Плейлист">
            <select className="input" value={b.ref} onChange={(e) => set((x) => void (x.ref = e.target.value))}>
              <option value="">— выберите —</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={`Треков в списке: ${b.count}`}>
            <Range2 value={b.count} min={0} max={12} step={1} onChange={(v) => set((x) => void (x.count = v))} format={(v) => String(v)} />
          </Field>
        </>
      )}

      {b.kind === 'links' && (
        <Field label="Ссылки">
          <div className="ed-links">
            {b.links.map((l, i) => (
              <div key={i} className="ed-link">
                <input className="input" value={l.label} placeholder="Подпись" maxLength={40} onChange={(e) => set((x) => void (x.links[i].label = e.target.value))} />
                <input className="input" value={l.url} placeholder="https://…" onChange={(e) => set((x) => void (x.links[i].url = e.target.value))} spellCheck={false} />
                <button className="icon-btn sm" onClick={() => set((x) => void x.links.splice(i, 1))} aria-label="Удалить ссылку"><Trash2 size={15} /></button>
              </div>
            ))}
            {b.links.length < 8 && <button className="btn sm" onClick={() => set((x) => void x.links.push({ label: '', url: '' }))}><Plus size={15} /> Ссылка</button>}
          </div>
        </Field>
      )}

      {b.kind === 'badges' && (
        <>
          <Field label="Какие">
            <Seg value={b.mode} options={[['auto', 'Все заработанные'], ['manual', 'Выбранные']]} onChange={(v) => set((x) => void (x.mode = v))} />
          </Field>
          {b.mode === 'manual' && (
            <div className="ed-chips">
              {BADGE_NAMES.map(([id, name]) => {
                const on = b.items.includes(id)
                return <button key={id} className={`ed-chip ${on ? 'on' : ''}`} onClick={() => set((x) => void (x.items = on ? x.items.filter((i) => i !== id) : [...x.items, id]))}>{on && <Check size={13} />} {name}</button>
              })}
            </div>
          )}
          <span className="ed-note">Показываются только заработанные значки.</span>
        </>
      )}

      {b.kind === 'year' && (
        <Field label="Год">
          <Seg value={String(b.year || 0)} options={[['0', 'Текущий'], ...yrs.filter((y) => y !== new Date().getFullYear()).map((y) => [String(y), String(y)] as [string, string])]} onChange={(v) => set((x) => void (x.year = Number(v)))} />
        </Field>
      )}

      {b.kind === 'nowPlaying' && <span className="ed-note">Показывает трек, который играет. Если ничего не играет — последний прослушанный. Скрыть от других можно во вкладке «Доступ».</span>}

      <Field label="Свой цвет блока">
        <ColorField value={b.accent} fallback="#6a5af9" label="Цвет блока" onChange={(v) => set((x) => void (x.accent = v))} />
      </Field>
    </div>
  )
}

// ───── редактор ─────

export function ShowcaseEditor({ selected, onSelect, onDone }: { selected: string | null; onSelect: (id: string | null) => void; onDone: () => void }) {
  const profile = useProfile((s) => s.profile)!
  const update = useProfile((s) => s.update)
  const tracks = useLibrary((s) => s.tracks)
  const toast = useUI((s) => s.toast)
  const openModal = useUI((s) => s.openModal)
  const [tab, setTab] = useState<Tab>(selected ? 'blocks' : 'profile')
  const [adding, setAdding] = useState(false)
  const p = profile

  const setBlock = (id: string) => (fn: (b: ShowcaseBlock) => void) =>
    update((x) => {
      const b = x.blocks.find((y) => y.id === id)
      if (b) fn(b)
    })
  const move = (i: number, d: number) =>
    update((x) => {
      const j = i + d
      if (j < 0 || j >= x.blocks.length) return
      ;[x.blocks[i], x.blocks[j]] = [x.blocks[j], x.blocks[i]]
    })
  const addBlock = (kind: ShowcaseBlockKind) => {
    const b = newBlock(kind)
    update((x) => void x.blocks.push(b))
    onSelect(b.id)
    setAdding(false)
  }
  const pickImage = async (kind: 'avatar' | 'banner') => {
    try {
      const url = await window.wave.profile.pickImage(kind)
      if (!url) return
      update((x) => {
        if (kind === 'avatar') x.avatar = url
        else {
          x.banner.image = url
          x.banner.kind = 'image'
        }
      })
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
    }
  }
  const coverTracks = useMemo(() => tracks.filter((t) => t.hasCover), [tracks])

  return (
    <aside className="ed glass" onClick={(e) => e.stopPropagation()}>
      <div className="ed-head">
        <span className="ed-title">Витрина</span>
        <button className="btn primary sm" onClick={onDone}><Check size={15} /> Готово</button>
        <div className="seg ed-tabs">
          {([['profile', 'Профиль'], ['look', 'Оформление'], ['blocks', 'Блоки'], ['access', 'Доступ']] as [Tab, string][]).map(([id, l]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="ed-body">
        {tab === 'profile' && (
          <>
            <h4>Аватар</h4>
            <div className="ed-row">
              <button className="btn sm" onClick={() => void pickImage('avatar')}><ImagePlus size={15} /> {p.avatar ? 'Заменить' : 'Загрузить'}</button>
              {p.avatar && <button className="btn sm" onClick={() => update((x) => void (x.avatar = ''))}><Trash2 size={15} /> Убрать</button>}
            </div>
            <span className="ed-note">JPG, PNG, WebP или анимированный GIF (до 1,7 МБ).</span>
            <Field label="Форма"><Seg value={p.avatarShape} options={[['circle', 'Круг'], ['squircle', 'Скруглённый'], ['square', 'Квадрат']]} onChange={(v) => update((x) => void (x.avatarShape = v))} /></Field>
            <Field label="Рамка"><Seg value={p.avatarFrame} options={[['none', 'Нет'], ['accent', 'Цвет'], ['gradient', 'Градиент'], ['glow', 'Свечение'], ['spin', 'Вращение']]} onChange={(v) => update((x) => void (x.avatarFrame = v))} /></Field>

            <h4>Имя и статус</h4>
            <Field label="Отображаемое имя"><input className="input" value={p.displayName} maxLength={40} placeholder="Как вас называть" onChange={(e) => update((x) => void (x.displayName = e.target.value))} /></Field>
            <Field label="Местоимения"><input className="input" value={p.pronouns} maxLength={30} placeholder="Необязательно" onChange={(e) => update((x) => void (x.pronouns = e.target.value))} /></Field>
            <Field label="Статус">
              <div className="ed-status">
                <input className="input ed-emoji" value={p.statusEmoji} maxLength={16} onChange={(e) => update((x) => void (x.statusEmoji = e.target.value))} aria-label="Эмодзи статуса" />
                <input className="input" value={p.status} maxLength={120} placeholder="Чем заняты, что слушаете" onChange={(e) => update((x) => void (x.status = e.target.value))} />
              </div>
              <div className="ed-emojis">
                {EMOJI.map((e) => <button key={e} className={p.statusEmoji === e ? 'on' : ''} onClick={() => update((x) => void (x.statusEmoji = e))}>{e}</button>)}
              </div>
            </Field>
            <Field label="О себе"><textarea className="input ed-area" rows={4} value={p.bio} maxLength={1000} placeholder="Пара слов под именем" onChange={(e) => update((x) => void (x.bio = e.target.value))} /></Field>

            <h4>Баннер</h4>
            <Field label="Что на баннере"><Seg value={p.banner.kind} options={[['gradient', 'Градиент'], ['color', 'Цвет'], ['image', 'Картинка'], ['cover', 'Обложка']]} onChange={(v) => update((x) => void (x.banner.kind = v))} /></Field>
            {p.banner.kind === 'image' && (
              <div className="ed-row">
                <button className="btn sm" onClick={() => void pickImage('banner')}><ImagePlus size={15} /> {p.banner.image ? 'Заменить картинку' : 'Загрузить картинку'}</button>
                {p.banner.image && <button className="btn sm" onClick={() => update((x) => void (x.banner.image = ''))}><Trash2 size={15} /></button>}
              </div>
            )}
            {p.banner.kind === 'cover' && (
              <Field label="Обложка какого трека">
                <ItemPicker kind="track" single value={p.banner.trackId ? [p.banner.trackId] : []} onChange={(v) => update((x) => void (x.banner.trackId = v[0] ?? coverTracks[0]?.id ?? ''))} />
              </Field>
            )}
            <Field label="Высота"><Range2 value={p.banner.height} min={90} max={320} step={10} onChange={(v) => update((x) => void (x.banner.height = v))} format={(v) => `${v}px`} /></Field>
          </>
        )}

        {tab === 'look' && (
          <>
            <h4>Палитра</h4>
            <div className="ed-palettes">
              {PALETTES.map(([name, a, b]) => (
                <button key={name} className={`ed-pal ${p.theme.primary === a && p.theme.secondary === b ? 'on' : ''}`} onClick={() => update((x) => { x.theme.primary = a; x.theme.secondary = b })} title={name}>
                  <span style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
                  <small>{name}</small>
                </button>
              ))}
            </div>
            <div className="ed-2">
              <Field label="Цвет 1"><input type="color" className="ed-color" value={p.theme.primary} onChange={(e) => update((x) => void (x.theme.primary = e.target.value))} /></Field>
              <Field label="Цвет 2"><input type="color" className="ed-color" value={p.theme.secondary} onChange={(e) => update((x) => void (x.theme.secondary = e.target.value))} /></Field>
            </div>
            <Field label="Угол градиента"><Range2 value={p.theme.angle} min={0} max={360} step={5} onChange={(v) => update((x) => void (x.theme.angle = v))} format={(v) => `${v}°`} /></Field>

            <h4>Карточка</h4>
            <Field label="Фон"><Seg value={p.theme.card} options={[['glass', 'Стекло'], ['gradient', 'Градиент'], ['solid', 'Сплошной'], ['outline', 'Контур']]} onChange={(v) => update((x) => void (x.theme.card = v))} /></Field>
            {p.theme.card === 'glass' && <Field label="Плотность стекла"><Range2 value={p.theme.opacity} min={0} max={1} step={0.05} onChange={(v) => update((x) => void (x.theme.opacity = v))} format={(v) => `${Math.round(v * 100)}%`} /></Field>}
            <Field label="Скругление"><Range2 value={p.theme.radius} min={0} max={36} step={1} onChange={(v) => update((x) => void (x.theme.radius = v))} format={(v) => `${v}px`} /></Field>
            <Field label="Эффект">
              <div className="ed-chips">
                {EFFECTS.map(([id, l]) => <button key={id} className={`ed-chip ${p.theme.effect === id ? 'on' : ''}`} onClick={() => update((x) => void (x.theme.effect = id))}>{l}</button>)}
              </div>
            </Field>

            <h4>Имя</h4>
            <Field label="Стиль имени"><Seg value={p.theme.nameStyle} options={[['plain', 'Обычный'], ['gradient', 'Градиент'], ['glow', 'Свечение'], ['outline', 'Контур']]} onChange={(v) => update((x) => void (x.theme.nameStyle = v))} /></Field>
            <Field label="Шрифт витрины">
              <select className="input" value={p.theme.font} onChange={(e) => update((x) => void (x.theme.font = e.target.value as Profile['theme']['font']))}>
                <option value="app">Как в приложении</option>
                {FONTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
          </>
        )}

        {tab === 'blocks' && (
          <>
            <h4>Шаблоны</h4>
            <div className="ed-templates">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className="ed-tpl"
                  onClick={() =>
                    openModal({
                      kind: 'confirm',
                      title: `Шаблон «${t.name}»`,
                      text: 'Текущие блоки витрины заменятся блоками шаблона. Имя, аватар и оформление останутся.',
                      confirmLabel: 'Применить',
                      onConfirm: () => {
                        update((x) => void (x.blocks = t.blocks()))
                        onSelect(null)
                      }
                    })
                  }
                >
                  <strong>{t.name}</strong>
                  <small>{t.desc}</small>
                </button>
              ))}
            </div>

            <div className="ed-blocks-head">
              <h4>Блоки</h4>
              <button className="btn sm primary" onClick={() => setAdding((v) => !v)}><Plus size={15} /> Добавить</button>
            </div>
            {adding && (
              <div className="ed-add">
                {BLOCK_KINDS.map((k) => (
                  <button key={k} className="ed-add-item" onClick={() => addBlock(k)}>
                    <span className="ed-add-ic"><Icon name={BLOCK_INFO[k].icon} size={18} /></span>
                    <span><strong>{BLOCK_INFO[k].title}</strong><small>{BLOCK_INFO[k].desc}</small></span>
                  </button>
                ))}
              </div>
            )}
            <div className="ed-blocks">
              {p.blocks.map((b, i) => {
                const open = selected === b.id
                return (
                  <div key={b.id} className={`ed-block ${open ? 'open' : ''} ${b.hidden ? 'off' : ''}`}>
                    <div className="ed-block-row">
                      <button className="ed-block-name" onClick={() => onSelect(open ? null : b.id)}>
                        <span className="ed-add-ic sm"><Icon name={BLOCK_INFO[b.kind].icon} size={15} /></span>
                        <span>{blockTitle(b)}</span>
                        <ChevronDown size={15} className="ed-chev" />
                      </button>
                      <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Выше"><ArrowUp size={15} /></button>
                      <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === p.blocks.length - 1} aria-label="Ниже"><ArrowDown size={15} /></button>
                      <button className="icon-btn sm" onClick={() => setBlock(b.id)((x) => void (x.hidden = !x.hidden))} aria-label={b.hidden ? 'Показать' : 'Скрыть'} title={b.hidden ? 'Показать' : 'Скрыть'}>{b.hidden ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                      <button className="icon-btn sm danger" onClick={() => { update((x) => void x.blocks.splice(i, 1)); if (open) onSelect(null) }} aria-label="Удалить" title="Удалить"><Trash2 size={15} /></button>
                    </div>
                    {open && (
                      <>
                        <BlockOptions b={b} set={setBlock(b.id)} />
                        <div className="ed-block-opts ed-block-dup">
                          <button className="btn sm" onClick={() => { const c = { ...structuredClone(b), id: newBlock(b.kind).id }; update((x) => void x.blocks.splice(i + 1, 0, c)); onSelect(c.id) }}><Copy size={15} /> Дублировать блок</button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
              {!p.blocks.length && <p className="ed-note">Блоков нет — нажмите «Добавить» или выберите шаблон.</p>}
            </div>
            <p className="ed-note">Нажмите на блок в превью, чтобы открыть его настройки.</p>
          </>
        )}

        {tab === 'access' && <AccessTab />}
      </div>
    </aside>
  )
}

function AccessTab() {
  const p = useProfile((s) => s.profile)!
  const update = useProfile((s) => s.update)
  const st = useProfile((s) => s.publish)
  const publishNow = useProfile((s) => s.publishNow)
  const navigate = useUI((s) => s.navigate)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.wave.sync.status().then((s) => setSignedIn(s.signedIn))
  }, [])

  return (
    <>
      <h4>Видимость</h4>
      <div className="ed-toggle">
        <span><strong>Показывать витрину другим</strong><small>Её увидят пользователи вашего сервера синхронизации — по имени или в списке «Люди на сервере».</small></span>
        <Toggle label="Показывать витрину" checked={p.publish} onChange={(v) => update((x) => void (x.publish = v))} />
      </div>
      <div className="ed-toggle">
        <span><strong>Показывать, что играет</strong><small>Блок «Сейчас слушаю» у других будет обновляться при смене трека.</small></span>
        <Toggle label="Показывать, что играет" checked={p.shareNowPlaying} onChange={(v) => update((x) => void (x.shareNowPlaying = v))} />
      </div>
      {signedIn === false && (
        <div className="ed-callout">
          <p>Чтобы витрину видели другие, войдите в аккаунт Wave. Сервер — ваш собственный: <code>npm run server</code>.</p>
          <button className="btn sm primary" onClick={() => navigate({ name: 'settings', tab: 'account' })}>Войти</button>
        </div>
      )}
      {signedIn && (
        <div className="ed-callout">
          <p>
            {st?.error ? <span className="err-text">{st.error}</span> : st?.published ? `Опубликовано ${st.at ? new Date(st.at).toLocaleString() : ''}` : p.publish ? 'Ещё не опубликовано' : 'Витрина видна только вам'}
          </p>
          {p.publish && (
            <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); await publishNow(); setBusy(false) }}>Опубликовать сейчас</button>
          )}
        </div>
      )}
      <p className="ed-note">На сервер уходят имя, аватар, баннер, тексты и уже посчитанные блоки (названия треков и маленькие обложки). Файлы и пути — никогда.</p>
    </>
  )
}
