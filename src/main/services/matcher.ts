import type { ImportItem } from '@shared/types'
import { normalize, stripFeat } from '../util'
import type { Candidate, YtDlp } from './ytdlp'

const BAD_WORDS = ['live', 'cover', 'karaoke', 'instrumental', 'remix', 'sped up', 'slowed', 'nightcore', 'reverb', '8d', 'acoustic', 'mashup', 'tribute', 'reaction', 'tutorial', 'lesson']

export interface Match {
  candidate: Candidate
  score: number
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length > 1)
}

export function scoreCandidate(item: ImportItem, c: Candidate): number {
  const wantTitle = normalize(stripFeat(item.title))
  const candTitle = normalize(c.title)
  const candChannel = normalize(c.channel ?? '')
  const artist = normalize(item.artists[0] ?? '')
  let score = 0

  // длительность — самый надёжный сигнал
  if (item.duration && c.duration) {
    const d = Math.abs(item.duration - c.duration)
    if (d <= 2) score += 45
    else if (d <= 5) score += 28
    else if (d <= 10) score += 6
    else score -= 70
  }

  // название
  if (wantTitle && candTitle.includes(wantTitle)) score += 30
  else {
    const want = tokens(wantTitle)
    const have = new Set(tokens(candTitle))
    if (want.length) score += (want.filter((t) => have.has(t)).length / want.length) * 22
  }

  // исполнитель
  if (artist && (candChannel.includes(artist) || candTitle.includes(artist))) score += 18
  if (/topic$/i.test(c.channel ?? '')) score += 25 // автоматический канал — чистое студийное аудио
  if (/\bvevo\b/i.test(c.channel ?? '')) score += 6

  // нежелательные версии, если их нет в запрошенном названии
  const wanted = normalize(item.title)
  for (const w of BAD_WORDS) {
    if (candTitle.includes(w) && !wanted.includes(w)) score -= 28
  }
  if (/official audio|provided to youtube/i.test(c.title)) score += 8
  if (/lyric/i.test(c.title)) score -= 4
  if (/music video|official video/i.test(c.title)) score -= 4
  return score
}

export const MIN_SCORE = 40

/** Ищет лучший аудиоисточник для трека (из Spotify/Яндекса) на YouTube Music / YouTube. */
export async function findBestMatch(yt: YtDlp, item: ImportItem, query: string, signal?: AbortSignal): Promise<Match | null> {
  const pool: Candidate[] = []
  try {
    pool.push(...(await yt.searchYouTubeMusic(query, signal)))
  } catch (e) {
    if (signal?.aborted) throw e
    /* поиск YouTube Music необязателен — идём в обычный YouTube */
  }
  let best = rank(item, pool)
  if (best && best.score >= MIN_SCORE + 15) return best

  pool.push(...(await yt.searchYouTube(`${query} audio`, 8, signal)))
  best = rank(item, dedupe(pool))
  return best && best.score >= MIN_SCORE ? best : null
}

function dedupe(list: Candidate[]): Candidate[] {
  const seen = new Set<string>()
  return list.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
}

function rank(item: ImportItem, pool: Candidate[]): Match | null {
  let best: Match | null = null
  for (const c of pool) {
    const score = scoreCandidate(item, c)
    if (!best || score > best.score) best = { candidate: c, score }
  }
  return best
}
