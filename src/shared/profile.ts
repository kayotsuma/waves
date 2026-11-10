// Профиль и витрина: значения по умолчанию, каталог блоков и строгая проверка данных.
// Проверка общая для своего профиля и для чужих, пришедших с сервера: чужие данные не должны ломать интерфейс
// и не должны протаскивать в страницу что-то кроме текста, цветов из палитры и картинок data:image.

import type {
  AvatarFrame,
  AvatarShape,
  FontName,
  NameStyle,
  Profile,
  ProfileCard,
  ProfileEffect,
  ProfileListItem,
  PublicProfile,
  ResolvedBlock,
  ShowcaseBadge,
  ShowcaseBlock,
  ShowcaseBlockKind,
  ShowcaseItem,
  ShowcaseLayout,
  ShowcasePeriod,
  StatKey,
  YearCard
} from './types'

export const BLOCK_KINDS: ShowcaseBlockKind[] = ['stats', 'tracks', 'artists', 'albums', 'track', 'playlist', 'nowPlaying', 'text', 'links', 'badges', 'activity', 'clock', 'year', 'quote']
export const STAT_KEYS: StatKey[] = ['minutes', 'plays', 'tracks', 'artists', 'albums', 'liked', 'playlists', 'streak', 'days', 'lossless', 'topHour', 'since']

export const BLOCK_INFO: Record<ShowcaseBlockKind, { title: string; desc: string; icon: string }> = {
  stats: { title: 'Статистика', desc: 'Минуты, прослушивания, треки — какие показатели, решаете вы', icon: 'BarChart3' },
  tracks: { title: 'Любимые треки', desc: 'Топ по прослушиваниям или свой список', icon: 'Music2' },
  artists: { title: 'Любимые исполнители', desc: 'Топ исполнителей или свой выбор', icon: 'Mic2' },
  albums: { title: 'Любимые альбомы', desc: 'Топ альбомов или свой выбор', icon: 'Disc3' },
  track: { title: 'Трек-визитка', desc: 'Один трек крупно — ваш гимн', icon: 'Star' },
  playlist: { title: 'Плейлист', desc: 'Показать один из своих плейлистов', icon: 'ListMusic' },
  nowPlaying: { title: 'Сейчас слушаю', desc: 'Что играет прямо сейчас', icon: 'Radio' },
  text: { title: 'О себе', desc: 'Любой текст', icon: 'Type' },
  links: { title: 'Ссылки', desc: 'Соцсети, сайт, что угодно', icon: 'Link2' },
  badges: { title: 'Значки', desc: 'Достижения за прослушивания и коллекцию', icon: 'Award' },
  activity: { title: 'Активность', desc: 'Сколько слушали каждый день за полгода', icon: 'CalendarDays' },
  clock: { title: 'Когда слушаю', desc: 'Прослушивания по часам суток', icon: 'Clock' },
  year: { title: 'Итог года', desc: 'Карточка с итогами года', icon: 'Sparkles' },
  quote: { title: 'Цитата', desc: 'Строчка из песни', icon: 'Quote' }
}

export const STAT_INFO: Record<StatKey, string> = {
  minutes: 'Минут музыки',
  plays: 'Прослушиваний',
  tracks: 'Треков',
  artists: 'Исполнителей',
  albums: 'Альбомов',
  liked: 'В любимом',
  playlists: 'Плейлистов',
  streak: 'Дней подряд',
  days: 'Дней с музыкой',
  lossless: 'Без потерь',
  topHour: 'Любимый час',
  since: 'В Wave с'
}

export const PERIOD_NAMES: [ShowcasePeriod, string][] = [
  ['all', 'Всё время'],
  ['year', 'Год'],
  ['month', 'Месяц'],
  ['week', 'Неделя']
]

const rid = () => Math.random().toString(36).slice(2, 10)

export function newBlock(kind: ShowcaseBlockKind, over: Partial<ShowcaseBlock> = {}): ShowcaseBlock {
  const full = kind === 'tracks' || kind === 'activity' || kind === 'stats' || kind === 'year'
  return {
    id: rid(),
    kind,
    title: '',
    size: full ? 'full' : 'half',
    hidden: false,
    mode: 'auto',
    period: kind === 'tracks' || kind === 'artists' || kind === 'albums' ? 'all' : 'year',
    count: kind === 'tracks' ? 5 : kind === 'artists' ? 6 : 4,
    layout: kind === 'artists' ? 'row' : kind === 'albums' ? 'grid' : 'list',
    items: kind === 'stats' ? ['minutes', 'plays', 'tracks', 'artists'] : [],
    text: '',
    links: [],
    ref: '',
    accent: '',
    year: 0,
    ...over
  }
}

export function defaultProfile(): Profile {
  return {
    displayName: '',
    pronouns: '',
    statusEmoji: '🎧',
    status: '',
    bio: '',
    avatar: '',
    avatarShape: 'circle',
    avatarFrame: 'gradient',
    banner: { kind: 'gradient', image: '', trackId: '', height: 180 },
    theme: { primary: '#6a5af9', secondary: '#ff5c8a', angle: 135, card: 'glass', effect: 'aurora', font: 'app', radius: 22, nameStyle: 'plain', opacity: 0.55 },
    blocks: [
      newBlock('nowPlaying', { size: 'full' }),
      newBlock('stats'),
      newBlock('tracks'),
      newBlock('artists', { size: 'full' }),
      newBlock('badges'),
      newBlock('clock'),
      newBlock('activity')
    ],
    publish: false,
    shareNowPlaying: true,
    updatedAt: 0
  }
}

// ───── проверка ─────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number, def = ''): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : def)
const num = (v: unknown, min: number, max: number, def: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def)
export const hexColor = (v: unknown, def: string): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def)
const hexOrEmpty = (v: unknown): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '')

/** Картинки — только data:image (без SVG: в нём может быть скрипт). */
export const MAX_IMAGE = 2_400_000
export function imageUrl(v: unknown, max = MAX_IMAGE): string {
  return typeof v === 'string' && v.length <= max && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(v) ? v : ''
}
/** Обложка элемента: своя (wave://cover) или data:image у чужого профиля. */
function coverRef(v: unknown, allowLocal: boolean): string | undefined {
  if (typeof v !== 'string') return undefined
  if (allowLocal && /^wave:\/\/cover\/[\w.-]+(\?v=\d+)?$/.test(v)) return v
  return imageUrl(v, 400_000) || undefined
}
export const safeLink = (v: unknown): string => {
  const s = str(v, 500).trim()
  if (!s) return ''
  const withProto = /^[a-z]+:/i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withProto)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''
  } catch {
    return ''
  }
}

const SHAPES: AvatarShape[] = ['circle', 'squircle', 'square']
const FRAMES: AvatarFrame[] = ['none', 'accent', 'gradient', 'glow', 'spin']
const CARDS: ProfileCard[] = ['glass', 'solid', 'gradient', 'outline']
const EFFECTS: ProfileEffect[] = ['none', 'aurora', 'stars', 'grain', 'waves', 'snow', 'bokeh']
const NAME_STYLES: NameStyle[] = ['plain', 'gradient', 'glow', 'outline']
const FONTS: (FontName | 'app')[] = ['app', 'system', 'google-sans', 'inter', 'manrope', 'space-grotesk']
const PERIODS: ShowcasePeriod[] = ['all', 'year', 'month', 'week']
const LAYOUTS: ShowcaseLayout[] = ['list', 'grid', 'podium', 'row']

export function sanitizeBlock(raw: unknown): ShowcaseBlock | null {
  if (!isObj(raw)) return null
  const kind = oneOf(raw.kind, BLOCK_KINDS, 'text')
  if (raw.kind !== kind) return null
  const base = newBlock(kind)
  return {
    id: /^[\w-]{1,40}$/.test(String(raw.id)) ? String(raw.id) : base.id,
    kind,
    title: str(raw.title, 60),
    size: oneOf(raw.size, ['half', 'full'] as const, base.size),
    hidden: raw.hidden === true,
    mode: oneOf(raw.mode, ['auto', 'manual'] as const, 'auto'),
    period: oneOf(raw.period, PERIODS, base.period),
    count: Math.round(num(raw.count, 1, 12, base.count)),
    layout: oneOf(raw.layout, LAYOUTS, base.layout),
    items: Array.isArray(raw.items) ? raw.items.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, 24) : [],
    text: str(raw.text, kind === 'text' ? 2000 : 400),
    links: Array.isArray(raw.links)
      ? raw.links
          .filter(isObj)
          .map((l) => ({ label: str(l.label, 40), url: safeLink(l.url) }))
          .filter((l) => l.url)
          .slice(0, 8)
      : [],
    ref: str(raw.ref, 80),
    accent: hexOrEmpty(raw.accent),
    year: Math.round(num(raw.year, 0, 2100, 0))
  }
}

export function sanitizeProfile(raw: unknown): Profile {
  const d = defaultProfile()
  if (!isObj(raw)) return d
  const banner = isObj(raw.banner) ? raw.banner : {}
  const theme = isObj(raw.theme) ? raw.theme : {}
  const blocks: ShowcaseBlock[] = []
  const ids = new Set<string>()
  for (const b of Array.isArray(raw.blocks) ? raw.blocks.slice(0, 40) : []) {
    const s = sanitizeBlock(b)
    if (!s) continue
    if (ids.has(s.id)) s.id = rid()
    ids.add(s.id)
    blocks.push(s)
  }
  return {
    displayName: str(raw.displayName, 40),
    pronouns: str(raw.pronouns, 30),
    statusEmoji: str(raw.statusEmoji, 16),
    status: str(raw.status, 120),
    bio: str(raw.bio, 1000),
    avatar: imageUrl(raw.avatar),
    avatarShape: oneOf(raw.avatarShape, SHAPES, d.avatarShape),
    avatarFrame: oneOf(raw.avatarFrame, FRAMES, d.avatarFrame),
    banner: {
      kind: oneOf(banner.kind, ['gradient', 'color', 'image', 'cover'] as const, d.banner.kind),
      image: imageUrl(banner.image),
      trackId: str(banner.trackId, 80),
      height: Math.round(num(banner.height, 90, 320, d.banner.height))
    },
    theme: {
      primary: hexColor(theme.primary, d.theme.primary),
      secondary: hexColor(theme.secondary, d.theme.secondary),
      angle: Math.round(num(theme.angle, 0, 360, d.theme.angle)),
      card: oneOf(theme.card, CARDS, d.theme.card),
      effect: oneOf(theme.effect, EFFECTS, d.theme.effect),
      font: oneOf(theme.font, FONTS, d.theme.font),
      radius: Math.round(num(theme.radius, 0, 36, d.theme.radius)),
      nameStyle: oneOf(theme.nameStyle, NAME_STYLES, d.theme.nameStyle),
      opacity: num(theme.opacity, 0, 1, d.theme.opacity)
    },
    blocks: Array.isArray(raw.blocks) ? blocks : d.blocks,
    publish: raw.publish === true,
    shareNowPlaying: raw.shareNowPlaying !== false,
    updatedAt: Math.round(num(raw.updatedAt, 0, 9e15, 0))
  }
}

function sanitizeItem(raw: unknown, allowLocal: boolean): ShowcaseItem | null {
  if (!isObj(raw)) return null
  const title = str(raw.title, 200)
  if (!title) return null
  return {
    title,
    sub: str(raw.sub, 200) || undefined,
    cover: coverRef(raw.cover, allowLocal),
    value: str(raw.value, 40) || undefined,
    trackId: allowLocal ? str(raw.trackId, 80) || undefined : undefined,
    key: allowLocal ? str(raw.key, 300) || undefined : undefined
  }
}

const ICONS = /^[A-Z][A-Za-z0-9]{1,30}$/

function sanitizeYear(raw: unknown, allowLocal: boolean): YearCard | undefined {
  if (!isObj(raw)) return undefined
  return {
    year: Math.round(num(raw.year, 2000, 2100, 2000)),
    minutes: Math.round(num(raw.minutes, 0, 1e9, 0)),
    plays: Math.round(num(raw.plays, 0, 1e9, 0)),
    topTrack: sanitizeItem(raw.topTrack, allowLocal) ?? undefined,
    topArtist: sanitizeItem(raw.topArtist, allowLocal) ?? undefined,
    persona: str(raw.persona, 60),
    personaDesc: str(raw.personaDesc, 200),
    artists: Math.round(num(raw.artists, 0, 1e7, 0)),
    tracks: Math.round(num(raw.tracks, 0, 1e7, 0))
  }
}

/** Развёрнутые данные блока. allowLocal — свои данные (можно ссылки wave://cover и id треков). */
export function sanitizeResolved(raw: unknown, allowLocal = false): ResolvedBlock {
  if (!isObj(raw)) return {}
  const out: ResolvedBlock = {}
  if (Array.isArray(raw.stats)) {
    out.stats = raw.stats
      .filter(isObj)
      .slice(0, 12)
      .map((s) => ({ key: oneOf(s.key, STAT_KEYS, 'plays'), label: str(s.label, 40), value: str(s.value, 40), hint: str(s.hint, 80) || undefined }))
  }
  if (Array.isArray(raw.items)) out.items = raw.items.slice(0, 24).map((i) => sanitizeItem(i, allowLocal)).filter((i): i is ShowcaseItem => !!i)
  if (Array.isArray(raw.activity)) out.activity = raw.activity.slice(0, 26 * 7).map((v) => num(v, 0, 1440, 0))
  if (raw.activityEnd !== undefined) out.activityEnd = num(raw.activityEnd, 0, 9e15, 0)
  if (Array.isArray(raw.clock)) out.clock = raw.clock.slice(0, 24).map((v) => num(v, 0, 1, 0))
  if (Array.isArray(raw.badges)) {
    out.badges = raw.badges
      .filter(isObj)
      .slice(0, 16)
      .map(
        (b): ShowcaseBadge => ({
          id: str(b.id, 30),
          label: str(b.label, 40),
          desc: str(b.desc, 120),
          icon: typeof b.icon === 'string' && ICONS.test(b.icon) ? b.icon : 'Award',
          color: hexColor(b.color, '#8b7bff')
        })
      )
  }
  if (raw.year) out.year = sanitizeYear(raw.year, allowLocal)
  if (isObj(raw.playlist)) {
    out.playlist = {
      name: str(raw.playlist.name, 100),
      count: Math.round(num(raw.playlist.count, 0, 1e6, 0)),
      minutes: Math.round(num(raw.playlist.minutes, 0, 1e7, 0)),
      covers: Array.isArray(raw.playlist.covers) ? raw.playlist.covers.slice(0, 4).map((c) => coverRef(c, allowLocal)).filter((c): c is string => !!c) : []
    }
  }
  if (raw.quoteBy) out.quoteBy = sanitizeItem(raw.quoteBy, allowLocal) ?? undefined
  if (raw.nowPlaying === null) out.nowPlaying = null
  else if (isObj(raw.nowPlaying)) {
    const np = sanitizeItem(raw.nowPlaying, allowLocal)
    out.nowPlaying = np ? { ...np, at: num(raw.nowPlaying.at, 0, 9e15, 0) } : null
  }
  return out
}

export function sanitizePublic(raw: unknown): PublicProfile | null {
  if (!isObj(raw) || !isObj(raw.profile)) return null
  const resolved: Record<string, ResolvedBlock> = {}
  if (isObj(raw.resolved)) for (const [k, v] of Object.entries(raw.resolved).slice(0, 40)) if (/^[\w-]{1,40}$/.test(k)) resolved[k] = sanitizeResolved(v)
  return {
    username: str(raw.username, 32),
    updatedAt: num(raw.updatedAt, 0, 9e15, 0),
    profile: sanitizeProfile(raw.profile),
    resolved,
    bannerCover: imageUrl(raw.bannerCover, 600_000) || undefined
  }
}

export function sanitizeListItem(raw: unknown): ProfileListItem | null {
  if (!isObj(raw) || typeof raw.username !== 'string') return null
  return {
    username: str(raw.username, 32),
    displayName: str(raw.displayName, 40),
    thumb: imageUrl(raw.thumb, 100_000) || undefined,
    statusEmoji: str(raw.statusEmoji, 16) || undefined,
    status: str(raw.status, 120) || undefined,
    nowPlaying: str(raw.nowPlaying, 200) || undefined,
    updatedAt: num(raw.updatedAt, 0, 9e15, 0)
  }
}
