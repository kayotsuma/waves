// Статистика прослушиваний: топы за период, активность по дням и часам, значки, итоги года.
// Источники: история прослушиваний (точная, с момента её появления) и снимок счётчиков, накопленных до неё
// (приблизительная часть: известно, сколько раз играл трек, но не когда именно).

import type { ListenInfo, ListenMeta, ListenYear, Playlist, ShowcaseBadge, ShowcasePeriod, Track } from '@shared/types'
import { plural } from './format'

const SEP = '\u0001'

export interface TrackAgg {
  id: string
  meta: ListenMeta
  plays: number
  seconds: number
}
export interface ArtistAgg {
  name: string
  plays: number
  seconds: number
  /** трек этого исполнителя, который слушали больше всего — для обложки */
  topId: string
  topPlays: number
}
export interface AlbumAgg {
  key: string
  title: string
  artist: string
  plays: number
  seconds: number
  topId: string
}

export interface Agg {
  seconds: number
  plays: number
  /** часть данных — по счётчикам до появления истории */
  approx: boolean
  tracks: Map<string, TrackAgg>
  artists: Map<string, ArtistAgg>
  albums: Map<string, AlbumAgg>
  /** секунды по часам суток (только история) */
  hours: number[]
  weekdays: number[]
  months: number[]
  /** yyyy-mm-dd → секунды */
  days: Map<string, number>
  historyPlays: number
}

export interface ListenSource {
  info: ListenInfo | null
  years: Record<number, ListenYear>
}

/** Засчитанное прослушивание: трек звучал хотя бы 30 секунд (или половину, если он короче минуты). */
export const counts = (s: number, duration: number) => s >= Math.min(30, Math.max(5, duration * 0.5))

export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function periodRange(period: ShowcasePeriod, now = Date.now()): [number, number] {
  if (period === 'all') return [0, Infinity]
  if (period === 'year') return [new Date(new Date(now).getFullYear(), 0, 1).getTime(), Infinity]
  return [startOfDay(now) - (period === 'month' ? 29 : 6) * 86400_000, Infinity]
}

function emptyAgg(): Agg {
  return {
    seconds: 0,
    plays: 0,
    approx: false,
    tracks: new Map(),
    artists: new Map(),
    albums: new Map(),
    hours: Array(24).fill(0),
    weekdays: Array(7).fill(0),
    months: Array(12).fill(0),
    days: new Map(),
    historyPlays: 0
  }
}

function add(a: Agg, id: string, meta: ListenMeta, plays: number, seconds: number): void {
  a.seconds += seconds
  a.plays += plays
  const t = a.tracks.get(id)
  if (t) {
    t.plays += plays
    t.seconds += seconds
    t.meta = meta
  } else a.tracks.set(id, { id, meta, plays, seconds })
  const names = meta.artists?.length ? meta.artists : [meta.artist]
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const k = name.toLowerCase()
    const x = a.artists.get(k)
    if (x) {
      x.plays += plays
      x.seconds += seconds
    } else a.artists.set(k, { name, plays, seconds, topId: id, topPlays: 0 })
  }
  if (meta.album) {
    const artist = meta.artists?.[0] ?? meta.artist
    const key = `${meta.album}${SEP}${artist}`
    const x = a.albums.get(key)
    if (x) {
      x.plays += plays
      x.seconds += seconds
    } else a.albums.set(key, { key, title: meta.album, artist, plays, seconds, topId: id })
  }
}

/** Собрать статистику за [from, to). Счётчики до истории учитываются целиком для «всего времени» и для своего года. */
export function aggregate(src: ListenSource, from: number, to: number, opts: { baselineYear?: number | 'all' } = {}): Agg {
  const a = emptyAgg()
  for (const y of Object.values(src.years)) {
    for (const [id, at, s] of y.rows) {
      if (at < from || at >= to) continue
      const meta = y.meta[id]
      if (!meta) continue
      const n = counts(s, meta.duration) ? 1 : 0
      add(a, id, meta, n, s)
      a.historyPlays += n
      const d = new Date(at)
      a.hours[d.getHours()] += s
      a.weekdays[(d.getDay() + 6) % 7] += s
      a.months[d.getMonth()] += s
      const k = dayKey(at)
      a.days.set(k, (a.days.get(k) ?? 0) + s)
    }
  }
  const base = src.info?.baseline
  if (base && opts.baselineYear !== undefined) {
    for (const [id, b] of Object.entries(base.tracks)) {
      if (opts.baselineYear !== 'all' && new Date(b.last).getFullYear() !== opts.baselineYear) continue
      add(a, id, b.meta, b.plays, b.plays * Math.min(b.meta.duration || 180, 600))
      a.approx = true
    }
  }
  // самый слушаемый трек каждого исполнителя (для обложки)
  for (const t of a.tracks.values()) {
    for (const raw of t.meta.artists?.length ? t.meta.artists : [t.meta.artist]) {
      const x = a.artists.get(raw.trim().toLowerCase())
      if (x && t.plays > x.topPlays) {
        x.topPlays = t.plays
        x.topId = t.id
      }
    }
  }
  return a
}

export function aggregatePeriod(src: ListenSource, period: ShowcasePeriod): Agg {
  const [from, to] = periodRange(period)
  return aggregate(src, from, to, { baselineYear: period === 'all' ? 'all' : period === 'year' ? new Date().getFullYear() : undefined })
}

const byPlays = <T extends { plays: number; seconds: number }>(a: T, b: T) => b.plays - a.plays || b.seconds - a.seconds

export const topTracks = (a: Agg, n: number) => [...a.tracks.values()].filter((t) => t.plays > 0 || t.seconds >= 30).sort(byPlays).slice(0, n)
export const topArtists = (a: Agg, n: number) => [...a.artists.values()].filter((t) => t.plays > 0).sort(byPlays).slice(0, n)
export const topAlbums = (a: Agg, n: number) => [...a.albums.values()].filter((t) => t.plays > 0).sort(byPlays).slice(0, n)

/** Самая длинная серия дней подряд с музыкой (от минуты в день) и текущая серия. */
export function streaks(days: Map<string, number>): { longest: number; current: number } {
  const on = new Set([...days].filter(([, s]) => s >= 60).map(([k]) => k))
  let longest = 0
  for (const k of on) {
    const [y, m, d] = k.split('-').map(Number)
    const prev = dayKey(new Date(y, m - 1, d - 1).getTime())
    if (on.has(prev)) continue
    let len = 1
    let cur = new Date(y, m - 1, d)
    for (;;) {
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
      if (!on.has(dayKey(cur.getTime()))) break
      len++
    }
    longest = Math.max(longest, len)
  }
  let current = 0
  let d = new Date()
  if (!on.has(dayKey(d.getTime()))) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)
  while (on.has(dayKey(d.getTime()))) {
    current++
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)
  }
  return { longest, current }
}

/** Минуты по дням за последние `weeks` недель; последний элемент — сегодня. */
export function activityDays(a: Agg, weeks = 26): number[] {
  const out: number[] = []
  const today = new Date()
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    out.push(Math.round((a.days.get(dayKey(d.getTime())) ?? 0) / 60))
  }
  return out
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('ru-RU')
export const minutesWord = (n: number) => plural(Math.round(n), 'минута', 'минуты', 'минут')
export const playsWord = (n: number) => plural(Math.round(n), 'прослушивание', 'прослушивания', 'прослушиваний')
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']

const share = (arr: number[], from: number, to: number) => {
  const total = arr.reduce((s, v) => s + v, 0)
  if (!total) return 0
  let x = 0
  for (let h = from; h < to; h++) x += arr[h % 24]
  return x / total
}

// ───── значки ─────

export interface BadgeCtx {
  tracks: Track[]
  playlists: Playlist[]
  all: Agg
}

export function computeBadges({ tracks, playlists, all }: BadgeCtx): ShowcaseBadge[] {
  const out: ShowcaseBadge[] = []
  const first = tracks.reduce((m, t) => Math.min(m, t.addedAt), Infinity)
  if (Number.isFinite(first)) {
    const d = new Date(first)
    out.push({ id: 'pioneer', label: 'С Wave', desc: `Слушает в Wave с ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`, icon: 'Waves', color: '#6a5af9' })
  }
  const n = tracks.length
  if (n >= 100) {
    const tier = n >= 2000 ? 'IV' : n >= 1000 ? 'III' : n >= 500 ? 'II' : 'I'
    out.push({ id: 'collector', label: `Коллекционер ${tier}`, desc: `${fmtInt(n)} ${plural(n, 'трек', 'трека', 'треков')} в медиатеке`, icon: 'Library', color: '#f5a524' })
  }
  const liked = tracks.filter((t) => t.liked).length
  if (liked >= 25) out.push({ id: 'hearts', label: 'Сердцеед', desc: `${fmtInt(liked)} ${plural(liked, 'трек', 'трека', 'треков')} в любимом`, icon: 'Heart', color: '#ff4d6d' })
  if (playlists.length >= 5) out.push({ id: 'curator', label: 'Куратор', desc: `${playlists.length} ${plural(playlists.length, 'плейлист', 'плейлиста', 'плейлистов')}`, icon: 'ListMusic', color: '#2ec4b6' })
  const lossless = tracks.filter((t) => t.lossless).length
  if (n >= 20 && lossless / n >= 0.3) out.push({ id: 'audiophile', label: 'Аудиофил', desc: `${Math.round((lossless / n) * 100)}% медиатеки — без потерь`, icon: 'Gem', color: '#4cc9f0' })
  const minutes = all.seconds / 60
  if (minutes >= 6000) out.push({ id: 'marathon', label: 'Марафонец', desc: `Больше ${fmtInt(Math.floor(minutes / 60))} часов музыки`, icon: 'Timer', color: '#ff7a45' })
  if (all.plays >= 1000) out.push({ id: 'thousand', label: 'Тысячник', desc: `${fmtInt(all.plays)} ${playsWord(all.plays)}`, icon: 'Flame', color: '#ff5c8a' })
  if (all.historyPlays >= 30 && share(all.hours, 0, 5) >= 0.25) out.push({ id: 'owl', label: 'Ночная сова', desc: 'Четверть музыки — после полуночи', icon: 'Moon', color: '#7b61ff' })
  if (all.historyPlays >= 30 && share(all.hours, 5, 10) >= 0.3) out.push({ id: 'lark', label: 'Ранняя пташка', desc: 'Музыка с самого утра', icon: 'Sunrise', color: '#ffb703' })
  const { longest } = streaks(all.days)
  if (longest >= 30) out.push({ id: 'streak30', label: 'Месяц без пауз', desc: `${longest} ${plural(longest, 'день', 'дня', 'дней')} подряд с музыкой`, icon: 'CalendarCheck', color: '#38b000' })
  else if (longest >= 7) out.push({ id: 'streak7', label: 'Неделя подряд', desc: `${longest} ${plural(longest, 'день', 'дня', 'дней')} подряд с музыкой`, icon: 'CalendarCheck', color: '#70e000' })
  const artists = new Set(tracks.flatMap((t) => (t.artists.length ? t.artists : [t.artist]))).size
  if (artists >= 100) out.push({ id: 'explorer', label: 'Исследователь', desc: `${fmtInt(artists)} исполнителей в медиатеке`, icon: 'Compass', color: '#00b4d8' })
  const fav = topArtists(all, 1)[0]
  if (fav && fav.plays >= 100) out.push({ id: 'fan', label: 'Фанат', desc: `${fmtInt(fav.plays)} ${playsWord(fav.plays)}: ${fav.name}`, icon: 'Crown', color: '#e9c46a' })
  return out
}

/** Все возможные значки — для выбора в редакторе (заработанные отмечаются отдельно). */
export const BADGE_NAMES: [string, string][] = [
  ['pioneer', 'С Wave'],
  ['collector', 'Коллекционер'],
  ['hearts', 'Сердцеед'],
  ['curator', 'Куратор'],
  ['audiophile', 'Аудиофил'],
  ['marathon', 'Марафонец'],
  ['thousand', 'Тысячник'],
  ['owl', 'Ночная сова'],
  ['lark', 'Ранняя пташка'],
  ['streak7', 'Неделя подряд'],
  ['streak30', 'Месяц без пауз'],
  ['explorer', 'Исследователь'],
  ['fan', 'Фанат']
]

// ───── итоги года ─────

export interface Persona {
  id: string
  title: string
  desc: string
  icon: string
}

export interface YearSummary {
  year: number
  agg: Agg
  minutes: number
  plays: number
  topTracks: TrackAgg[]
  topArtists: ArtistAgg[]
  topAlbums: AlbumAgg[]
  uniqueTracks: number
  uniqueArtists: number
  /** минуты по месяцам (только история) */
  months: number[]
  hours: number[]
  weekdays: number[]
  topDay: { key: string; minutes: number } | null
  topMonth: number | null
  streak: number
  firstPlay: { id: string; meta: ListenMeta; at: number } | null
  newTracks: number
  newArtists: number
  addedByMonth: number[]
  persona: Persona
  approx: boolean
  hasHistory: boolean
  since: number
}

export function yearsAvailable(src: ListenSource, tracks: Track[]): number[] {
  const ys = new Set<number>(src.info?.years ?? [])
  for (const b of Object.values(src.info?.baseline?.tracks ?? {})) ys.add(new Date(b.last).getFullYear())
  for (const t of tracks) if (t.plays > 0 && t.lastPlayedAt) ys.add(new Date(t.lastPlayedAt).getFullYear())
  ys.add(new Date().getFullYear())
  return [...ys].sort((a, b) => b - a)
}

export function yearSummary(src: ListenSource, year: number, tracks: Track[]): YearSummary {
  const from = new Date(year, 0, 1).getTime()
  const to = new Date(year + 1, 0, 1).getTime()
  const agg = aggregate(src, from, to, { baselineYear: year })
  const tt = topTracks(agg, 50)
  const ta = topArtists(agg, 10)
  const months = agg.months.map((s) => Math.round(s / 60))
  const topMonthIdx = months.some((m) => m > 0) ? months.indexOf(Math.max(...months)) : null
  let topDay: YearSummary['topDay'] = null
  for (const [key, s] of agg.days) if (!topDay || s / 60 > topDay.minutes) topDay = { key, minutes: Math.round(s / 60) }
  let firstPlay: YearSummary['firstPlay'] = null
  const yr = src.years[year]
  if (yr) {
    for (const [id, at, s] of yr.rows) {
      const meta = yr.meta[id]
      if (meta && counts(s, meta.duration) && (!firstPlay || at < firstPlay.at)) firstPlay = { id, meta, at }
    }
  }
  const added = tracks.filter((t) => t.addedAt >= from && t.addedAt < to)
  const addedByMonth = Array(12).fill(0)
  for (const t of added) addedByMonth[new Date(t.addedAt).getMonth()]++
  // новые исполнители: впервые появились в медиатеке в этом году
  const firstSeen = new Map<string, number>()
  for (const t of tracks) for (const a of t.artists.length ? t.artists : [t.artist]) firstSeen.set(a, Math.min(firstSeen.get(a) ?? Infinity, t.addedAt))
  const newArtists = [...firstSeen.values()].filter((at) => at >= from && at < to).length

  const minutes = Math.round(agg.seconds / 60)
  const s: Omit<YearSummary, 'persona'> = {
    year,
    agg,
    minutes,
    plays: agg.plays,
    topTracks: tt,
    topArtists: ta,
    topAlbums: topAlbums(agg, 5),
    uniqueTracks: [...agg.tracks.values()].filter((t) => t.plays > 0).length,
    uniqueArtists: [...agg.artists.values()].filter((t) => t.plays > 0).length,
    months,
    hours: agg.hours,
    weekdays: agg.weekdays,
    topDay,
    topMonth: topMonthIdx,
    streak: streaks(agg.days).longest,
    firstPlay,
    newTracks: added.length,
    newArtists,
    addedByMonth,
    approx: agg.approx,
    hasHistory: agg.historyPlays > 0,
    since: src.info?.since ?? 0
  }
  return { ...s, persona: persona(s) }
}

function persona(s: Omit<YearSummary, 'persona'>): Persona {
  const top = s.topArtists[0]
  const topShare = top && s.plays ? top.plays / s.plays : 0
  const night = s.agg.historyPlays >= 20 ? share(s.hours, 0, 5) : 0
  const morning = s.agg.historyPlays >= 20 ? share(s.hours, 5, 10) : 0
  const tt = s.topTracks[0]
  const repeat = tt && s.plays ? tt.plays / s.plays : 0
  const cands: [number, Persona][] = [
    [topShare / 0.25, { id: 'fan', title: 'Преданный фанат', desc: top ? `${top.name} — каждая ${Math.max(2, Math.round(1 / Math.max(topShare, 0.01)))}-я песня за год. Это любовь.` : '', icon: 'Crown' }],
    [night / 0.25, { id: 'owl', title: 'Ночная сова', desc: `${Math.round(night * 100)}% музыки — между полуночью и пятью утра.`, icon: 'Moon' }],
    [morning / 0.3, { id: 'lark', title: 'Ранняя пташка', desc: `${Math.round(morning * 100)}% музыки — с пяти до десяти утра.`, icon: 'Sunrise' }],
    [tt && tt.plays >= 25 ? repeat / 0.07 : 0, { id: 'repeat', title: 'На повторе', desc: tt ? `«${tt.meta.title}» — ${tt.plays} раз. Кнопка повтора устала.` : '', icon: 'Repeat' }],
    [s.uniqueArtists >= 40 && topShare < 0.12 ? s.uniqueArtists / 40 : 0, { id: 'explorer', title: 'Исследователь', desc: `${s.uniqueArtists} исполнителей и ни одного главного — вам интересно всё.`, icon: 'Compass' }],
    [s.newTracks / 150, { id: 'collector', title: 'Коллекционер', desc: `${fmtInt(s.newTracks)} новых треков в медиатеке за год.`, icon: 'Library' }],
    [s.minutes / 20000, { id: 'marathon', title: 'Марафонец', desc: `${fmtInt(s.minutes)} минут — это ${Math.round(s.minutes / 1440)} ${plural(Math.round(s.minutes / 1440), 'сутки', 'суток', 'суток')} без перерыва.`, icon: 'Timer' }]
  ]
  cands.sort((a, b) => b[0] - a[0])
  if (cands[0][0] >= 1) return cands[0][1]
  return { id: 'meloman', title: 'Меломан', desc: 'Музыка — каждый день, на своих условиях.', icon: 'Headphones' }
}
