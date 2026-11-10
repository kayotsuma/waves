import type { LyricLine, Track } from '@shared/types'
import { fetchJson } from '../util'
import { parseMeta, sim } from './genius'

const LRCLIB = 'https://lrclib.net/api'
const LRCLIB_HEADERS = { 'lrclib-client': 'Wave Player (personal use)' }

interface LrclibRecord {
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
  trackName?: string
  artistName?: string
}

export interface LrclibResult {
  synced?: string
  plain?: string
  /** разница длительности найденной записи и нашего трека, секунды */
  durationDiff?: number
}

/** «(0:05–0:12)» — приписка от вырезанного фрагмента, к названию песни не относится. */
export function lyricsTitle(t: string): string {
  return t.replace(/\s*[([]\s*\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\s*[)\]]/g, '').trim()
}

/** Имена исполнителя для поиска: «Юпи (@jupi_sleep)» → Юпи, jupi, jupi sleep; «onda_andar» → onda andar. */
export function artistNames(track: Track): string[] {
  const meta = parseMeta(track.artists[0] ?? track.artist, lyricsTitle(track.title))
  const out = new Set<string>()
  for (const a of meta.artistAliases) {
    out.add(a)
    const spaced = a.replace(/[_.]+/g, ' ').trim()
    if (spaced) out.add(spaced)
  }
  return [...out]
}

const get = <T>(path: string) => fetchJson<T>(`${LRCLIB}/${path}`, { headers: LRCLIB_HEADERS, timeout: 12000 })
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString()

/** Поиск в LRCLIB по нескольким вариантам названия и исполнителя, с оценкой совпадения. */
export async function searchLrclib(track: Track): Promise<LrclibResult | null> {
  const title0 = lyricsTitle(track.title)
  const meta = parseMeta(track.artists[0] ?? track.artist, title0)
  const artists = artistNames(track)
  const titles = meta.titleVariants.slice(0, 3)
  const dur = Math.round(track.duration)

  // 1. точное совпадение по тегам и длительности (самый надёжный вариант)
  const exactTries: Record<string, string>[] = []
  for (const a of artists.slice(0, 3)) {
    for (const t of titles.slice(0, 2)) {
      exactTries.push({ artist_name: a, track_name: t, duration: String(dur) })
      if (track.album) exactTries.push({ artist_name: a, track_name: t, album_name: track.album, duration: String(dur) })
    }
  }
  for (const p of exactTries.slice(0, 6)) {
    try {
      const r = await get<LrclibRecord>(`get?${qs(p)}`)
      if (r && (r.syncedLyrics || r.plainLyrics) && !r.instrumental) {
        return { synced: r.syncedLyrics ?? undefined, plain: r.plainLyrics ?? undefined, durationDiff: r.duration ? Math.abs(r.duration - track.duration) : 0 }
      }
    } catch {
      /* не найдено — следующий вариант */
    }
  }

  // 2. поиск и оценка кандидатов
  const queries: Record<string, string>[] = []
  const a0 = artists[0] ?? ''
  for (const t of titles) {
    if (a0) queries.push({ track_name: t, artist_name: a0 })
    queries.push({ q: `${a0} ${t}`.trim() })
  }
  if (titles[0]) queries.push({ q: titles[0] })
  const seen = new Set<string>()
  const pool: LrclibRecord[] = []
  for (const q of queries.slice(0, 7)) {
    const key = JSON.stringify(q)
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const list = await get<LrclibRecord[]>(`search?${qs(q)}`)
      for (const r of list) if (!r.instrumental && (r.syncedLyrics || r.plainLyrics)) pool.push(r)
    } catch {
      /* следующий запрос */
    }
    if (pool.length >= 40) break
  }

  const scored = pool
    .map((r) => {
      const names = `${r.trackName ?? ''}`
      const ts = Math.max(0, ...titles.map((t) => sim(t, names)))
      const as = artists.length ? Math.max(0, ...artists.map((a) => Math.max(sim(a, r.artistName ?? ''), sim(a, names)))) : 0.5
      const dd = r.duration ? Math.abs(r.duration - track.duration) : 99
      const score = ts * 50 + as * 30 + (dd <= 2 ? 30 : dd <= 5 ? 20 : dd <= 12 ? 5 : -20) + (r.syncedLyrics ? 10 : 0)
      return { r, ts, as, dd, score }
    })
    .filter((x) => x.ts >= 0.75 && x.as >= 0.45)
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best) return null
  // синхронизацию берём, только если длительность близка: иначе это другая версия песни и строки поедут
  const synced = best.dd <= 12 ? best.r.syncedLyrics ?? undefined : undefined
  const plain = best.r.plainLyrics ?? undefined
  if (!synced && !plain) return null
  return { synced, plain, durationDiff: best.dd }
}

// ───── примерная синхронизация по тексту ─────

const SECTION = /^\s*[[(].{0,40}[\])]\s*$/

/**
 * Если точной синхронизации нет, раскладывает строки обычного текста по времени трека: пропорционально длине строк,
 * внутри «окна пения», найденного по огибающей громкости. Это приближение, а не распознавание: на каждом треке точность разная.
 */
export function estimateSync(plain: string, duration: number, peaks?: number[] | null): LyricLine[] {
  const raw = plain.split(/\r?\n/)
  const items: { text: string; w: number }[] = []
  let gap = false
  for (const l of raw) {
    const text = l.trim()
    if (!text) {
      gap = true
      continue
    }
    if (SECTION.test(text)) continue
    items.push({ text, w: Math.max(8, text.length) + (gap && items.length ? 10 : 0) })
    gap = false
  }
  if (!items.length || !(duration > 5)) return []

  let start = Math.min(10, duration * 0.06)
  let end = duration - Math.min(10, duration * 0.05)
  if (peaks && peaks.length > 20) {
    const sorted = [...peaks].sort((a, b) => a - b)
    const thr = sorted[Math.floor(sorted.length * 0.9)] * 0.3
    const n = peaks.length
    let i = 0
    while (i < n - 3 && !(peaks[i] > thr && peaks[i + 1] > thr && peaks[i + 2] > thr)) i++
    let j = n - 1
    while (j > 3 && !(peaks[j] > thr && peaks[j - 1] > thr && peaks[j - 2] > thr)) j--
    const s = (i / n) * duration
    const e = ((j + 1) / n) * duration
    // вступление считаем «пением» не сразу: даём около 3 секунд на начало голоса
    if (e - s > duration * 0.4) {
      start = Math.min(s + 3, duration * 0.4)
      end = Math.max(start + 10, e - Math.min(6, duration * 0.03))
    }
  }
  const total = items.reduce((a, b) => a + b.w, 0)
  let acc = 0
  return items.map((it) => {
    const t = start + (acc / total) * (end - start)
    acc += it.w
    return { t: Math.round(t * 100) / 100, text: it.text }
  })
}
