import { useMemo } from 'react'
import {
  Award,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  Clock,
  Compass,
  Crown,
  Disc3,
  Flame,
  Gem,
  Globe,
  Headphones,
  Heart,
  Library,
  Link2,
  ListMusic,
  Mic2,
  Moon,
  Music,
  Music2,
  Play,
  Quote,
  Radio,
  Repeat,
  Sparkles,
  Star,
  Sunrise,
  Timer,
  Type,
  Waves
} from 'lucide-react'
import { BLOCK_INFO, PERIOD_NAMES } from '@shared/profile'
import type { Profile, ResolvedBlock, ShowcaseBlock, ShowcaseData, ShowcaseItem } from '@shared/types'
import { FONTS } from '@/lib/themes'
import { hashHue } from '@/lib/format'
import { fmtInt, MONTHS_SHORT, minutesWord } from '@/lib/stats'

export const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  Award, BarChart3, CalendarCheck, CalendarDays, Clock, Compass, Crown, Disc3, Flame, Gem, Globe, Headphones, Heart, Library, Link2,
  ListMusic, Mic2, Moon, Music, Music2, Quote, Radio, Repeat, Sparkles, Star, Sunrise, Timer, Type, Waves
}
export const Icon = ({ name, size = 18, className }: { name: string; size?: number; className?: string }) => {
  const C = ICONS[name] ?? Award
  return <C size={size} className={className} />
}

/** Яркость цвета #rrggbb, 0…1. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255)
}

export interface ShowcaseActions {
  /** свой профиль: клик по треку включает его, по исполнителю/альбому — открывает */
  onTrack?: (id: string, all: string[]) => void
  onKey?: (kind: 'artist' | 'album', key: string) => void
  onYear?: (year: number) => void
  onLink?: (url: string) => void
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase()
}

export function Avatar({ profile, name, size = 112, className = '' }: { profile: Pick<Profile, 'avatar' | 'avatarShape' | 'avatarFrame'>; name: string; size?: number; className?: string }) {
  return (
    <span className={`sc-avatar shape-${profile.avatarShape} frame-${profile.avatarFrame} ${className}`} style={{ width: size, height: size, ['--h' as string]: hashHue(name) }}>
      <span className="sc-avatar-in">
        {profile.avatar ? <img src={profile.avatar} alt="" draggable={false} /> : <span className="sc-initials" style={{ fontSize: size * 0.36 }}>{initials(name)}</span>}
      </span>
    </span>
  )
}

function Cov({ src, size, round, label }: { src?: string; size?: number; round?: boolean; label: string }) {
  return (
    <span className={`sc-cov ${round ? 'round' : ''}`} style={size ? { width: size, height: size } : undefined}>
      {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span className="sc-cov-fb" style={{ ['--h' as string]: hashHue(label) }}><Music size={size ? size * 0.36 : 20} /></span>}
    </span>
  )
}

function Items({ b, r, act }: { b: ShowcaseBlock; r: ResolvedBlock; act: ShowcaseActions }) {
  const items = r.items ?? []
  if (!items.length) return <p className="sc-empty">{b.mode === 'manual' ? 'Ничего не выбрано' : 'Пока нет прослушиваний за этот период'}</p>
  const round = b.kind === 'artists'
  const ids = items.map((i) => i.trackId).filter((x): x is string => !!x)
  const click = (i: ShowcaseItem) => {
    if (i.trackId && act.onTrack) act.onTrack(i.trackId, ids)
    else if (i.key && act.onKey) act.onKey(b.kind === 'artists' ? 'artist' : 'album', i.key)
  }
  const clickable = (i: ShowcaseItem) => !!((i.trackId && act.onTrack) || (i.key && act.onKey))
  const layout = b.layout

  if (layout === 'podium' && items.length >= 3) {
    const [a, c, d] = [items[1], items[0], items[2]]
    return (
      <div className="sc-podium">
        {[a, c, d].map((i, k) => (
          <button key={k} className={`sc-pod p${k}`} onClick={() => click(i)} disabled={!clickable(i)}>
            <span className="sc-pod-rank">{k === 1 ? 1 : k === 0 ? 2 : 3}</span>
            <Cov src={i.cover} round={round} label={i.title} />
            <strong>{i.title}</strong>
            {i.sub && <span>{i.sub}</span>}
            {i.value && <em>{i.value}</em>}
          </button>
        ))}
        {items.length > 3 && (
          <div className="sc-pod-rest">
            {items.slice(3).map((i, k) => (
              <button key={k} className="sc-li" onClick={() => click(i)} disabled={!clickable(i)}>
                <span className="sc-rank">{k + 4}</span>
                <Cov src={i.cover} size={34} round={round} label={i.title} />
                <span className="sc-li-t"><strong>{i.title}</strong>{i.sub && <span>{i.sub}</span>}</span>
                {i.value && <em>{i.value}</em>}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (layout === 'grid' || layout === 'row') {
    return (
      <div className={layout === 'grid' ? 'sc-gridl' : 'sc-rowl'}>
        {items.map((i, k) => (
          <button key={k} className="sc-gi" onClick={() => click(i)} disabled={!clickable(i)} title={i.sub ? `${i.title} — ${i.sub}` : i.title}>
            <Cov src={i.cover} round={round} label={i.title} />
            <strong>{i.title}</strong>
            {(i.sub || i.value) && <span>{layout === 'row' ? i.value ?? i.sub : i.sub}</span>}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="scv-list">
      {items.map((i, k) => (
        <button key={k} className="sc-li" onClick={() => click(i)} disabled={!clickable(i)}>
          {b.mode === 'auto' && <span className="sc-rank">{k + 1}</span>}
          <Cov src={i.cover} size={44} round={round} label={i.title} />
          <span className="sc-li-t"><strong>{i.title}</strong>{i.sub && <span>{i.sub}</span>}</span>
          {i.value && <em>{i.value}</em>}
        </button>
      ))}
    </div>
  )
}

function Activity({ r }: { r: ResolvedBlock }) {
  const days = r.activity ?? []
  const max = Math.max(30, ...days)
  const total = days.reduce((s, v) => s + v, 0)
  // сетка по неделям: столбец — неделя, сверху понедельник
  const end = new Date(r.activityEnd || Date.now())
  const pad = 6 - ((end.getDay() + 6) % 7)
  const cells = [...days, ...Array(pad).fill(-1)]
  const cols = Math.ceil(cells.length / 7)
  const monthLabels: { col: number; label: string }[] = []
  for (let c = 0; c < cols; c++) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days.length - 1 - c * 7))
    if (d.getDate() <= 7) monthLabels.push({ col: c, label: MONTHS_SHORT[d.getMonth()] })
  }
  return (
    <div className="sc-act">
      <div className="sc-act-months" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {monthLabels.map((m) => <span key={m.col} style={{ gridColumn: m.col + 1 }}>{m.label}</span>)}
      </div>
      <div className="sc-act-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {cells.map((v, i) => (
          <i key={i} className={v < 0 ? 'fut' : ''} style={{ gridColumn: Math.floor(i / 7) + 1, gridRow: (i % 7) + 1, ['--a' as string]: v > 0 ? 0.22 + 0.78 * Math.min(1, v / max) : 0 }} title={v >= 0 ? `${v} ${minutesWord(v)}` : undefined} />
        ))}
      </div>
      <p className="sc-foot">{total ? `${fmtInt(total)} ${minutesWord(total)} за полгода` : 'История прослушиваний только началась — клетки будут заполняться'}</p>
    </div>
  )
}

function ClockChart({ r }: { r: ResolvedBlock }) {
  const v = r.clock ?? []
  const max = Math.max(...v, 0.0001)
  const top = v.indexOf(Math.max(...v))
  if (!v.some((x) => x > 0)) return <p className="sc-empty">Нужна история прослушиваний — она уже записывается</p>
  const part = top < 5 ? 'ночью' : top < 12 ? 'утром' : top < 18 ? 'днём' : 'вечером'
  return (
    <div className="sc-clock">
      <div className="sc-clock-bars">
        {v.map((x, h) => <i key={h} className={h === top ? 'top' : ''} style={{ height: `${8 + 92 * (x / max)}%` }} title={`${h}:00 — ${Math.round(x * 100)}%`} />)}
      </div>
      <div className="sc-clock-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      <p className="sc-foot">Чаще всего — {part}, около {String(top).padStart(2, '0')}:00</p>
    </div>
  )
}

function YearMini({ r, act }: { r: ResolvedBlock; act: ShowcaseActions }) {
  const y = r.year
  if (!y) return null
  return (
    <button className="sc-year" onClick={() => act.onYear?.(y.year)} disabled={!act.onYear}>
      <span className="sc-year-n">{y.year}</span>
      <span className="sc-year-body">
        <span className="sc-year-row">
          <span><b>{fmtInt(y.minutes)}</b><small>{minutesWord(y.minutes)}</small></span>
          <span><b>{fmtInt(y.artists)}</b><small>исполнителей</small></span>
          <span><b>{fmtInt(y.tracks)}</b><small>треков</small></span>
        </span>
        {y.topArtist && (
          <span className="sc-year-top">
            <Cov src={y.topArtist.cover} size={40} round label={y.topArtist.title} />
            <span><small>Исполнитель года</small><strong>{y.topArtist.title}</strong></span>
          </span>
        )}
        {y.topTrack && (
          <span className="sc-year-top">
            <Cov src={y.topTrack.cover} size={40} label={y.topTrack.title} />
            <span><small>Песня года</small><strong>{y.topTrack.title}</strong></span>
          </span>
        )}
        <span className="sc-year-persona"><Sparkles size={14} /> {y.persona}</span>
      </span>
    </button>
  )
}

function linkIcon(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    return h
  } catch {
    return url
  }
}

function BlockBody({ b, r, act }: { b: ShowcaseBlock; r: ResolvedBlock; act: ShowcaseActions }) {
  switch (b.kind) {
    case 'stats':
      return (
        <div className="sc-stats">
          {(r.stats ?? []).map((s) => (
            <div key={s.key} className="sc-stat" title={s.hint}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
          {!r.stats?.length && <p className="sc-empty">Выберите показатели в редакторе</p>}
        </div>
      )
    case 'tracks':
    case 'artists':
    case 'albums':
      return <Items b={b} r={r} act={act} />
    case 'track': {
      const i = r.items?.[0]
      if (!i) return <p className="sc-empty">Трек не выбран</p>
      return (
        <div className="sc-feature">
          <button className="sc-feature-art" onClick={() => i.trackId && act.onTrack?.(i.trackId, [i.trackId])} disabled={!i.trackId || !act.onTrack}>
            <Cov src={i.cover} label={i.title} />
            {i.trackId && act.onTrack && <span className="sc-play"><Play size={20} fill="currentColor" /></span>}
          </button>
          <div className="sc-feature-t">
            <strong>{i.title}</strong>
            <span>{i.sub}</span>
            {b.text && <p>{b.text}</p>}
          </div>
        </div>
      )
    }
    case 'playlist': {
      const p = r.playlist
      if (!p) return <p className="sc-empty">Плейлист не выбран</p>
      return (
        <div className="sc-pl">
          <div className="sc-pl-head">
            <span className="sc-pl-art">
              {p.covers.length >= 4 ? p.covers.slice(0, 4).map((c, k) => <img key={k} src={c} alt="" />) : <Cov src={p.covers[0]} label={p.name} />}
            </span>
            <span className="sc-pl-t"><strong>{p.name}</strong><span>{p.count} тр. · {fmtInt(p.minutes)} мин</span></span>
          </div>
          {!!r.items?.length && <Items b={{ ...b, layout: 'list', mode: 'manual' }} r={r} act={act} />}
        </div>
      )
    }
    case 'nowPlaying': {
      const np = r.nowPlaying
      if (!np) return <p className="sc-empty">Сейчас тишина</p>
      const live = Date.now() - np.at < 10 * 60_000
      return (
        <div className={`sc-np ${live ? 'live' : ''}`}>
          <span className="sc-np-art"><Cov src={np.cover} label={np.title} /></span>
          <span className="sc-np-t">
            <small>{live ? <><span className="sc-eq"><i /><i /><i /></span> Слушает сейчас</> : 'Недавно играло'}</small>
            <strong>{np.title}</strong>
            <span>{np.sub}</span>
          </span>
          {np.trackId && act.onTrack && <button className="sc-np-play" onClick={() => act.onTrack!(np.trackId!, [np.trackId!])} aria-label="Включить"><Play size={18} fill="currentColor" /></button>}
        </div>
      )
    }
    case 'text':
      return b.text ? <p className="sc-text">{b.text}</p> : <p className="sc-empty">Напишите что-нибудь в редакторе</p>
    case 'links':
      return b.links.length ? (
        <div className="sc-links">
          {b.links.map((l, k) => (
            <button key={k} className="sc-link" onClick={() => act.onLink?.(l.url)} title={l.url}>
              <Globe size={16} />
              <span><strong>{l.label || linkIcon(l.url)}</strong>{l.label && <small>{linkIcon(l.url)}</small>}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="sc-empty">Добавьте ссылки в редакторе</p>
      )
    case 'badges':
      return r.badges?.length ? (
        <div className="sc-badges">
          {r.badges.map((x) => (
            <span key={x.id} className="sc-badge" style={{ ['--b' as string]: x.color }} title={x.desc}>
              <span className="sc-badge-ic"><Icon name={x.icon} size={18} /></span>
              <span><strong>{x.label}</strong><small>{x.desc}</small></span>
            </span>
          ))}
        </div>
      ) : (
        <p className="sc-empty">Значки появятся по мере прослушиваний</p>
      )
    case 'activity':
      return <Activity r={r} />
    case 'clock':
      return <ClockChart r={r} />
    case 'year':
      return <YearMini r={r} act={act} />
    case 'quote':
      return (
        <figure className="sc-quote">
          <Quote size={28} className="sc-quote-mark" />
          <blockquote>{b.text || 'Строчка из любимой песни'}</blockquote>
          {r.quoteBy && <figcaption>— {r.quoteBy.title}{r.quoteBy.sub ? `, ${r.quoteBy.sub}` : ''}</figcaption>}
        </figure>
      )
  }
}

export function blockTitle(b: ShowcaseBlock): string {
  return b.title || BLOCK_INFO[b.kind].title
}

function periodLabel(b: ShowcaseBlock): string | null {
  const auto = ['tracks', 'artists', 'albums'].includes(b.kind) ? b.mode === 'auto' : b.kind === 'stats' || b.kind === 'clock'
  if (!auto) return null
  return PERIOD_NAMES.find(([p]) => p === b.period)?.[1] ?? null
}

export function ShowcaseBlockView({ b, r, act, editing, selected, onSelect }: { b: ShowcaseBlock; r: ResolvedBlock; act: ShowcaseActions; editing?: boolean; selected?: boolean; onSelect?: () => void }) {
  const period = periodLabel(b)
  const bare = b.kind === 'year' || b.kind === 'nowPlaying' || b.kind === 'quote'
  return (
    <section
      className={`sc-block k-${b.kind} ${b.size} ${bare ? 'bare' : ''} ${selected ? 'sel' : ''} ${editing ? 'editing' : ''}`}
      style={b.accent ? { ['--sc-1' as string]: b.accent } : undefined}
      onClick={editing ? (e) => { e.stopPropagation(); onSelect?.() } : undefined}
    >
      {!bare && (
        <header className="sc-block-h">
          <h3><Icon name={BLOCK_INFO[b.kind].icon} size={16} /> {blockTitle(b)}</h3>
          {period && <span className="sc-chip">{period}</span>}
        </header>
      )}
      <BlockBody b={b} r={r} act={act} />
    </section>
  )
}

export interface ShowcaseProps {
  data: ShowcaseData
  username?: string
  act?: ShowcaseActions
  /** кнопки в шапке (свои: «Изменить», «Поделиться») */
  actions?: React.ReactNode
  editing?: boolean
  selectedBlock?: string | null
  onSelectBlock?: (id: string) => void
  className?: string
  id?: string
}

export function Showcase({ data, username, act = {}, actions, editing, selectedBlock, onSelectBlock, className = '', id }: ShowcaseProps) {
  const p = data.profile
  const t = p.theme
  const name = p.displayName || username || 'Слушатель'
  const style = useMemo(() => {
    const tone = luminance(t.primary) * 0.5 + luminance(t.secondary) * 0.5 > 0.42 ? 'light' : 'dark'
    const font = t.font === 'app' ? undefined : FONTS.find((f) => f.id === t.font)?.css
    return {
      tone,
      vars: {
        ['--sc-1' as string]: t.primary,
        ['--sc-2' as string]: t.secondary,
        ['--sc-angle' as string]: `${t.angle}deg`,
        ['--sc-r' as string]: `${t.radius}px`,
        ['--sc-op' as string]: t.opacity,
        ['--sc-banner-h' as string]: `${p.banner.height}px`,
        ...(font ? { fontFamily: font } : {})
      } as React.CSSProperties
    }
  }, [t, p.banner.height])

  const banner =
    p.banner.kind === 'image' && p.banner.image
      ? { backgroundImage: `url("${p.banner.image}")` }
      : p.banner.kind === 'cover' && data.bannerCover
        ? { backgroundImage: `url("${data.bannerCover}")` }
        : undefined
  const visible = p.blocks.filter((b) => !b.hidden)

  return (
    <article id={id} className={`sc card-${t.card} fx-${t.effect} name-${t.nameStyle} tone-${style.tone} ${className}`} style={style.vars}>
      <div className="sc-fx" aria-hidden />
      <div className={`sc-banner kind-${p.banner.kind} ${banner ? 'has-img' : ''}`} style={banner} />
      <header className="sc-head">
        <Avatar profile={p} name={name} />
        <div className="sc-id">
          <h1 className="sc-name">{name}</h1>
          <p className="sc-handle">
            {username && <span>@{username}</span>}
            {p.pronouns && <span>{p.pronouns}</span>}
          </p>
          {(p.status || p.statusEmoji) && (
            <p className="sc-status">
              {p.statusEmoji && <span className="sc-emoji">{p.statusEmoji}</span>}
              {p.status}
            </p>
          )}
        </div>
        {actions && <div className="sc-actions">{actions}</div>}
      </header>
      {p.bio && <p className="sc-bio">{p.bio}</p>}
      <div className="sc-grid">
        {visible.map((b) => (
          <ShowcaseBlockView key={b.id} b={b} r={data.resolved[b.id] ?? {}} act={act} editing={editing} selected={selectedBlock === b.id} onSelect={() => onSelectBlock?.(b.id)} />
        ))}
        {!visible.length && <p className="sc-empty wide">Витрина пуста — добавьте блоки в редакторе.</p>}
      </div>
    </article>
  )
}
