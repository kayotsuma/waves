// Превращает блоки витрины в готовые к показу данные (ResolvedBlock) — одинаково для своей витрины
// и для той, что уходит на сервер. У себя обложки — ссылки wave://cover, на сервер main подставит маленькие картинки.

import { STAT_INFO } from '@shared/profile'
import type { Playlist, Profile, ResolvedBlock, ShowcaseBlock, ShowcaseItem, ShowcasePeriod, StatKey, Track, YearCard } from '@shared/types'
import { groupAlbums } from './collections'
import { coverUrl } from './format'
import {
  activityDays,
  aggregatePeriod,
  computeBadges,
  fmtInt,
  MONTHS_SHORT,
  streaks,
  topAlbums,
  topArtists,
  topTracks,
  yearSummary,
  type Agg,
  type ListenSource
} from './stats'

export interface ShowcaseCtx {
  tracks: Track[]
  byId: Record<string, Track>
  playlists: Playlist[]
  listens: ListenSource
  /** что сейчас играет (или null) */
  current: Track | null
  playing: boolean
}

const SEP = '\u0001'

export function trackItem(t: Track | undefined, value?: string): ShowcaseItem | null {
  if (!t) return null
  return { title: t.title, sub: t.artist, cover: coverUrl(t), value, trackId: t.id }
}

function cache(ctx: ShowcaseCtx) {
  const aggs = new Map<ShowcasePeriod, Agg>()
  const agg = (p: ShowcasePeriod) => {
    let a = aggs.get(p)
    if (!a) aggs.set(p, (a = aggregatePeriod(ctx.listens, p)))
    return a
  }
  return { agg }
}

const timesLabel = (n: number) => `${fmtInt(n)}×`

function statValue(key: StatKey, ctx: ShowcaseCtx, a: Agg, period: ShowcasePeriod): { value: string; hint?: string } {
  const lib = ctx.tracks
  switch (key) {
    case 'minutes':
      return { value: fmtInt(a.seconds / 60), hint: a.approx ? 'частично по счётчикам' : undefined }
    case 'plays':
      return { value: fmtInt(a.plays) }
    case 'tracks':
      return period === 'all' ? { value: fmtInt(lib.length), hint: 'в медиатеке' } : { value: fmtInt([...a.tracks.values()].filter((t) => t.plays > 0).length), hint: 'прослушано' }
    case 'artists':
      return period === 'all'
        ? { value: fmtInt(new Set(lib.flatMap((t) => (t.artists.length ? t.artists : [t.artist]))).size), hint: 'в медиатеке' }
        : { value: fmtInt([...a.artists.values()].filter((t) => t.plays > 0).length), hint: 'прослушано' }
    case 'albums':
      return { value: fmtInt(groupAlbums(lib).length) }
    case 'liked':
      return { value: fmtInt(lib.filter((t) => t.liked).length) }
    case 'playlists':
      return { value: fmtInt(ctx.playlists.length) }
    case 'streak':
      return { value: fmtInt(streaks(a.days).longest), hint: 'лучшая серия' }
    case 'days':
      return { value: fmtInt([...a.days.values()].filter((s) => s >= 60).length) }
    case 'lossless':
      return { value: fmtInt(lib.filter((t) => t.lossless).length) }
    case 'topHour': {
      const max = Math.max(...a.hours)
      return max > 0 ? { value: `${String(a.hours.indexOf(max)).padStart(2, '0')}:00` } : { value: '—' }
    }
    case 'since': {
      const first = lib.reduce((m, t) => Math.min(m, t.addedAt), Infinity)
      if (!Number.isFinite(first)) return { value: '—' }
      const d = new Date(first)
      return { value: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` }
    }
  }
}

function yearCard(ctx: ShowcaseCtx, year: number): YearCard {
  const s = yearSummary(ctx.listens, year, ctx.tracks)
  const tt = s.topTracks[0]
  const ta = s.topArtists[0]
  return {
    year,
    minutes: s.minutes,
    plays: s.plays,
    topTrack: tt ? { title: tt.meta.title, sub: tt.meta.artist, cover: coverUrl(ctx.byId[tt.id]), value: timesLabel(tt.plays), trackId: tt.id } : undefined,
    topArtist: ta ? { title: ta.name, cover: coverUrl(ctx.byId[ta.topId]), value: timesLabel(ta.plays), key: ta.name } : undefined,
    persona: s.persona.title,
    personaDesc: s.persona.desc,
    artists: s.uniqueArtists,
    tracks: s.uniqueTracks
  }
}

export function resolveBlock(b: ShowcaseBlock, ctx: ShowcaseCtx, c = cache(ctx)): ResolvedBlock {
  const n = b.count
  switch (b.kind) {
    case 'stats': {
      const a = c.agg(b.period)
      return { stats: (b.items as StatKey[]).filter((k) => k in STAT_INFO).map((key) => ({ key, label: STAT_INFO[key], ...statValue(key, ctx, a, b.period) })) }
    }
    case 'tracks': {
      if (b.mode === 'manual') return { items: b.items.map((id) => trackItem(ctx.byId[id])).filter((x): x is ShowcaseItem => !!x).slice(0, n) }
      // за всё время точнее счётчики медиатеки (учитывают и другие устройства)
      if (b.period === 'all') {
        const top = ctx.tracks.filter((t) => t.plays > 0).sort((x, y) => y.plays - x.plays).slice(0, n)
        return { items: top.map((t) => trackItem(t, timesLabel(t.plays))!) }
      }
      return {
        items: topTracks(c.agg(b.period), n).map((t) => {
          const lt = ctx.byId[t.id]
          return lt ? trackItem(lt, timesLabel(t.plays))! : { title: t.meta.title, sub: t.meta.artist, value: timesLabel(t.plays) }
        })
      }
    }
    case 'artists': {
      if (b.mode === 'manual') {
        return {
          items: b.items.slice(0, n).map((name) => {
            const own = ctx.tracks.filter((t) => (t.artists.length ? t.artists : [t.artist]).includes(name))
            const best = own.sort((x, y) => y.plays - x.plays)[0]
            return { title: name, cover: coverUrl(best), value: own.length ? `${own.length} ${own.length === 1 ? 'трек' : 'тр.'}` : undefined, key: name }
          })
        }
      }
      return { items: topArtists(c.agg(b.period), n).map((x) => ({ title: x.name, cover: coverUrl(ctx.byId[x.topId]), value: timesLabel(x.plays), key: x.name })) }
    }
    case 'albums': {
      if (b.mode === 'manual') {
        const groups = new Map(groupAlbums(ctx.tracks).map((g) => [g.key, g]))
        return {
          items: b.items
            .map((k) => groups.get(k))
            .filter((g) => !!g)
            .slice(0, n)
            .map((g) => ({ title: g!.title, sub: g!.subtitle, cover: coverUrl(g!.tracks.find((t) => t.hasCover)), key: g!.key }))
        }
      }
      return {
        items: topAlbums(c.agg(b.period), n).map((x) => ({ title: x.title, sub: x.artist, cover: coverUrl(ctx.byId[x.topId]), value: timesLabel(x.plays), key: `${x.title}${SEP}${x.artist}` }))
      }
    }
    case 'track': {
      const t = ctx.byId[b.ref]
      return { items: t ? [trackItem(t, t.plays ? timesLabel(t.plays) : undefined)!] : [] }
    }
    case 'playlist': {
      const p = ctx.playlists.find((x) => x.id === b.ref)
      if (!p) return {}
      const list = p.trackIds.map((id) => ctx.byId[id]).filter(Boolean)
      return {
        playlist: {
          name: p.name,
          count: list.length,
          minutes: Math.round(list.reduce((s, t) => s + t.duration, 0) / 60),
          covers: list
            .filter((t) => t.hasCover)
            .slice(0, 4)
            .map((t) => coverUrl(t)!)
        },
        items: list.slice(0, n).map((t) => trackItem(t)!)
      }
    }
    case 'nowPlaying': {
      if (ctx.current && ctx.playing) return { nowPlaying: { ...trackItem(ctx.current)!, at: Date.now() } }
      // ничего не играет — последнее прослушанное
      const last = [...ctx.tracks].filter((t) => t.lastPlayedAt).sort((x, y) => (y.lastPlayedAt ?? 0) - (x.lastPlayedAt ?? 0))[0]
      return { nowPlaying: last ? { ...trackItem(last)!, at: last.lastPlayedAt ?? 0 } : null }
    }
    case 'badges': {
      const all = computeBadges({ tracks: ctx.tracks, playlists: ctx.playlists, all: c.agg('all') })
      return { badges: b.mode === 'manual' ? all.filter((x) => b.items.includes(x.id)) : all.slice(0, Math.max(n, 4) * 2) }
    }
    case 'activity':
      return { activity: activityDays(c.agg('all')), activityEnd: Date.now() }
    case 'clock': {
      const a = c.agg(b.period)
      const total = a.hours.reduce((s, v) => s + v, 0)
      return { clock: a.hours.map((v) => (total ? v / total : 0)) }
    }
    case 'year':
      return { year: yearCard(ctx, b.year || new Date().getFullYear()) }
    case 'quote':
      return { quoteBy: trackItem(ctx.byId[b.ref]) ?? undefined }
    case 'text':
    case 'links':
      return {}
  }
}

export function resolveShowcase(p: Profile, ctx: ShowcaseCtx): Record<string, ResolvedBlock> {
  const c = cache(ctx)
  const out: Record<string, ResolvedBlock> = {}
  for (const b of p.blocks) if (!b.hidden) out[b.id] = resolveBlock(b, ctx, c)
  return out
}
