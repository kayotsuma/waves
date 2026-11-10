import { HTMLElement, parse, TextNode, type Node } from 'node-html-parser'
import type { GeniusCandidate } from '@shared/types'
import { fetchJson, fetchText, HttpError, normalize, stripFeat } from '../util'

// Genius не отдаёт тексты через официальный API, а страницы защищены от автоматических запросов.
// Поэтому здесь только честная попытка обычным запросом: если Genius отвечает защитной страницей
// (403/429), мы НЕ пытаемся её обходить — сообщаем об этом и предлагаем открыть страницу в браузере.

export type GeniusResult =
  | { ok: true; text: string; url: string }
  | { ok: false; reason: 'blocked' | 'notfound' | 'error'; note: string; candidates?: GeniusCandidate[] }

interface Hit {
  url: string
  title: string
  artist: string
  /** все имена исполнителей страницы (основной + featured) */
  names: string[]
}

// ───── транслитерация и «нечёткое» сравнение ─────
// Названия на Genius часто отличаются от тегов в плеере: «Юпи» ↔ «Jupi», «Кодекс Рыцаря (prod. by jupi)» ↔ «Kodeks Rytsarya»,
// у артиста в тегах бывает «(@ник)». Поэтому сравниваем не строки, а нормализованные формы с транслитом и биграммами.

const CYR_A: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'ju', я: 'ja', і: 'i', ї: 'i', є: 'e', ґ: 'g' }
const CYR_B: Record<string, string> = { ...CYR_A, й: 'y', х: 'kh', ц: 'ts', щ: 'shch', ы: 'y', ю: 'yu', я: 'ya', ё: 'yo', е: 'e' }

const hasCyr = (s: string) => /[\u0400-\u04FF]/.test(s)
const translit = (s: string, map: Record<string, string>) => [...s.toLowerCase()].map((c) => map[c] ?? c).join('')

/** Нормализованные формы строки: как есть и (для кириллицы) в двух вариантах латиницы. */
function forms(s: string): string[] {
  const base = normalize(s)
  if (!base) return []
  return hasCyr(base) ? [base, normalize(translit(base, CYR_A)), normalize(translit(base, CYR_B))] : [base]
}

function bigrams(s: string): Map<string, number> {
  const t = ` ${s.replace(/\s+/g, ' ')} `
  const m = new Map<string, number>()
  for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1)
  return m
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const x = bigrams(a)
  const y = bigrams(b)
  let inter = 0
  for (const [k, v] of x) inter += Math.min(v, y.get(k) ?? 0)
  return (2 * inter) / (a.length + b.length)
}

/** Схожесть двух строк 0..1 с учётом транслита и вхождения целых слов. */
export function sim(a: string, b: string): number {
  let best = 0
  for (const x of forms(a)) {
    for (const y of forms(b)) {
      let v = dice(x, y)
      // одна строка целиком входит в другую по границам слов («jupi» в «jupi sleep»)
      if (x && y && (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `))) v = Math.max(v, 0.85)
      if (v > best) best = v
    }
  }
  return best
}

// ───── разбор тегов трека ─────

const PLACEHOLDER_ARTIST = /^(?:unknown(?: artist)?|неизвестный(?: исполнитель| артист)?|various artists?|разные исполнители|n a|none|no artist|artist)$/

const NOISE = /\b(?:prod\.?|feat\.?|ft\.?|featuring|with|remix|remaster(?:ed)?|official|video|audio|lyrics?|clip|visuali[sz]er|slowed|sped|reverb|bass boosted|music video)\b|клип|премьера/i

export interface Meta {
  artistAliases: string[]
  titleVariants: string[]
}

function cleanText(s: string): string {
  return s
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseMeta(artist: string, title: string): Meta {
  const aliases = new Set<string>()
  const addAlias = (a: string) => {
    const t = cleanText(a)
    // «Unknown Artist» и подобные — не исполнитель: на Genius так подписаны тысячи чужих песен
    if (normalize(t).length >= 2 && !PLACEHOLDER_ARTIST.test(normalize(t))) aliases.add(t)
  }
  // порядок важен (из первых строятся запросы): основное имя, затем короткий ник, затем полный
  const baseArtist = cleanText(artist.replace(/\(?\s*@[\w.]+\s*\)?/g, ''))
  for (const a of baseArtist.split(/\s*(?:,|&|;|\sx\s|\sfeat\.?\s|\sft\.?\s)\s*/i)) addAlias(a)
  // «Юпи (@jupi_sleep)» → «Юпи», «jupi», «jupi sleep»
  for (const m of artist.matchAll(/@([\w.]+)/g)) {
    const words = m[1].split(/[._]+/).filter(Boolean)
    if (words.length) {
      addAlias(words[0])
      addAlias(words.join(' '))
    }
  }
  // «(prod. by jupi)» в названии — часто тот же исполнитель
  for (const m of title.matchAll(/prod\.?\s*(?:by\s+)?([^)\]]+)/gi)) addAlias(m[1].replace(/[,&].*$/, ''))

  const variants = new Set<string>()
  const noBrackets = cleanText(title.replace(/\s*[([{][^)\]}]*[)\]}]/g, ''))
  if (noBrackets) variants.add(noBrackets)
  variants.add(cleanText(stripFeat(title)))
  // содержимое скобок без «prod/feat/remix» — может оказаться переводом названия: «Кодекс Рыцаря (The Knight's Code)»
  for (const m of title.matchAll(/[([{]([^)\]}]+)[)\]}]/g)) if (!NOISE.test(m[1])) variants.add(cleanText(m[1]))
  variants.add(cleanText(title))
  return { artistAliases: [...aliases], titleVariants: [...variants].filter((v) => normalize(v)) }
}

function hitTitleVariants(h: Hit): string[] {
  const out = new Set<string>([h.title, stripFeat(h.title), h.title.replace(/\s*[([{][^)\]}]*[)\]}]/g, '').trim()])
  for (const m of h.title.matchAll(/[([{]([^)\]}]+)[)\]}]/g)) out.add(m[1])
  return [...out].filter(Boolean)
}

const TRANSLATION = /translation|перевод|romaniz|traducci|tradução|übersetzung|türkçe|genius\s+(?:russian|english)/i

interface Scored extends Hit {
  artistScore: number
  titleScore: number
  score: number
}

export function scoreHits(hits: Hit[], meta: Meta): Scored[] {
  const seen = new Set<string>()
  const out: Scored[] = []
  for (const h of hits) {
    if (seen.has(h.url)) continue
    seen.add(h.url)
    if (TRANSLATION.test(`${h.title} ${h.artist}`)) continue
    let artistScore = 0
    for (const a of meta.artistAliases) for (const n of [h.artist, ...h.names]) artistScore = Math.max(artistScore, sim(a, n))
    let titleScore = 0
    for (const t of meta.titleVariants) for (const ht of hitTitleVariants(h)) titleScore = Math.max(titleScore, sim(t, ht))
    out.push({ ...h, artistScore, titleScore, score: 0.55 * artistScore + 0.45 * titleScore })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Уверенное совпадение берём сами; остальное предлагаем пользователю. */
export function decide(scored: Scored[]): { best: Scored | null; candidates: Scored[] } {
  const best = scored.find((h) => (h.artistScore >= 0.8 && h.titleScore >= 0.55) || (h.titleScore >= 0.9 && h.artistScore >= 0.5)) ?? null
  const candidates = scored.filter((h) => h.artistScore >= 0.6 || h.titleScore >= 0.6).slice(0, 6)
  return { best, candidates }
}

function slugPart(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/['’`".!?,()[\]{}*:;/\\]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Адреса Genius «по шаблону»: исполнитель-название-lyrics (в том числе с транслитом и вариантами названия). */
function slugCandidates(meta: Meta): string[] {
  const out = new Set<string>()
  const artists = meta.artistAliases.flatMap((a) => (hasCyr(a) ? [translit(a, CYR_A), translit(a, CYR_B)] : [a]))
  const titles = meta.titleVariants.flatMap((t) => (hasCyr(t) ? [translit(t, CYR_A), translit(t, CYR_B)] : [t]))
  for (const a of artists.slice(0, 4)) {
    for (const t of titles.slice(0, 6)) {
      const s = `${slugPart(a)}-${slugPart(t)}-lyrics`.replace(/-+/g, '-')
      if (s.length > 12) out.add(`https://genius.com/${s.charAt(0).toUpperCase()}${s.slice(1).toLowerCase()}`)
    }
  }
  return [...out].slice(0, 12)
}

function hitFrom(r: any): Hit | null {
  if (!r?.url || !r.title) return null
  const names = [r.primary_artist?.name, ...(r.featured_artists ?? []).map((a: any) => a?.name), ...String(r.artist_names ?? '').split(/\s*(?:&|,|\sx\s|\sfeat\.?\s)\s*/i)].filter(Boolean)
  return { url: r.url, title: r.title, artist: r.primary_artist?.name ?? r.artist_names ?? '', names }
}

async function searchApi(q: string, token: string): Promise<Hit[]> {
  const j = await fetchJson<any>(`https://api.genius.com/search?q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Bearer ${token}` }
  })
  return (j.response?.hits ?? []).filter((h: any) => h.type === 'song').map((h: any) => hitFrom(h.result)).filter(Boolean) as Hit[]
}

/** Поиск, которым пользуется сам сайт Genius (без токена). Если сайт отвечает защитной страницей — не обходим, просто пропускаем. */
async function searchPublic(q: string): Promise<Hit[]> {
  const j = await fetchJson<any>(`https://genius.com/api/search/song?q=${encodeURIComponent(q)}`, { timeout: 12000 })
  const hits: Hit[] = []
  for (const sec of j.response?.sections ?? []) for (const h of sec.hits ?? []) if (h.type === 'song') {
    const x = hitFrom(h.result)
    if (x) hits.push(x)
  }
  return hits
}

/** Набор разных запросов: Genius ищет капризно, а у нас тег может быть кириллицей, с мусором в скобках и без переводов. */
export function buildQueries(meta: Meta): string[] {
  const qs = new Set<string>()
  const a0 = meta.artistAliases[0] ?? ''
  const aLat = meta.artistAliases.find((a) => !hasCyr(a)) ?? (a0 ? translit(a0, CYR_B) : '')
  const t0 = meta.titleVariants[0] ?? ''
  const tLat = hasCyr(t0) ? translit(t0, CYR_B) : t0
  qs.add(`${a0} ${t0}`)
  if (aLat) qs.add(`${aLat} ${tLat}`)
  if (aLat) qs.add(aLat) // все песни исполнителя — выручает, когда название переведено
  qs.add(t0)
  for (const v of meta.titleVariants.slice(1, 4).filter((x) => !NOISE.test(x))) qs.add(`${aLat || a0} ${v}`)
  return [...qs].map((q) => q.replace(/\s+/g, ' ').trim()).filter((q) => q.length >= 2).slice(0, 5)
}

function walk(node: Node, out: string[]): void {
  if (node instanceof TextNode) {
    out.push(node.text)
    return
  }
  if (!(node instanceof HTMLElement)) return
  if (node.tagName === 'BR') {
    out.push('\n')
    return
  }
  if (node.getAttribute('data-exclude-from-selection') === 'true') return
  for (const c of node.childNodes) walk(c, out)
}

export function extractLyrics(html: string): string | null {
  const root = parse(html)
  const containers = root.querySelectorAll('[data-lyrics-container="true"]')
  if (!containers.length) return null
  const parts: string[] = []
  for (const c of containers) {
    const buf: string[] = []
    walk(c, buf)
    parts.push(buf.join(''))
  }
  let text = parts.join('\n').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  text = text.replace(/^\d+\s+Contributors?[\s\S]*?Lyrics\s*/i, '').trim()
  if (/^this song is an instrumental/i.test(text)) return null
  return text || null
}

export function geniusSearchUrl(artist: string, title: string): string {
  const meta = parseMeta(artist, title)
  return `https://genius.com/search?q=${encodeURIComponent(`${meta.artistAliases[0] ?? artist} ${meta.titleVariants[0] ?? title}`)}`
}

const BLOCKED_NOTE =
  'Genius не отдаёт текст программам (защита от ботов). Откройте страницу в браузере, скопируйте текст и вставьте его кнопкой «Вставить текст».'

async function tryPage(url: string): Promise<{ text?: string; blocked?: boolean }> {
  try {
    const text = extractLyrics(await fetchText(url, { timeout: 12000 }))
    return text ? { text } : {}
  } catch (e) {
    return e instanceof HttpError && (e.status === 403 || e.status === 429 || e.status === 503) ? { blocked: true } : {}
  }
}

export async function fetchGeniusLyrics(artist: string, title: string, token: string): Promise<GeniusResult> {
  const meta = parseMeta(artist, title)
  let blocked = false
  let tokenRejected = false
  let hits: Hit[] = []

  // 1. поиск (по нескольким запросам параллельно): с токеном — официальный API, без — публичный поиск сайта
  const queries = buildQueries(meta)
  if (token) {
    const rs = await Promise.allSettled(queries.map((q) => searchApi(q, token)))
    for (const r of rs) {
      if (r.status === 'fulfilled') hits.push(...r.value)
      else if (r.reason instanceof HttpError && r.reason.status === 401) tokenRejected = true
    }
    if (tokenRejected && !hits.length) return { ok: false, reason: 'error', note: 'Токен Genius отклонён — проверьте его в Настройках.' }
  } else {
    const first = await Promise.allSettled([searchPublic(queries[0])])
    if (first[0].status === 'fulfilled') {
      hits.push(...first[0].value)
      const rest = await Promise.allSettled(queries.slice(1).map((q) => searchPublic(q)))
      for (const r of rest) if (r.status === 'fulfilled') hits.push(...r.value)
    } else if (first[0].reason instanceof HttpError && [403, 429, 503].includes(first[0].reason.status)) blocked = true
  }

  const { best, candidates } = decide(scoreHits(hits, meta))
  const urls: string[] = []
  if (best) urls.push(best.url)
  // 2. адреса «по шаблону» — на случай, если поиск недоступен
  urls.push(...slugCandidates(meta))

  for (const url of [...new Set(urls)]) {
    const r = await tryPage(url)
    if (r.text) return { ok: true, text: r.text, url }
    if (r.blocked) blocked = true
  }

  const cands: GeniusCandidate[] = candidates.map((c) => ({ url: c.url, title: c.title, artist: c.artist }))
  if (blocked) return { ok: false, reason: 'blocked', note: BLOCKED_NOTE, candidates: cands.length ? cands : undefined }
  return {
    ok: false,
    reason: 'notfound',
    note: cands.length
      ? 'Точного совпадения на Genius нет (название там может быть переведено или написано иначе). Выберите подходящую страницу из найденных или вставьте ссылку на неё.'
      : 'На Genius не нашлось подходящей страницы. Если знаете адрес — вставьте ссылку на неё.',
    candidates: cands.length ? cands : undefined
  }
}

/** Текст по конкретной ссылке Genius (выбранной пользователем). Допускаются только страницы текста на genius.com. */
export async function fetchGeniusUrl(raw: string): Promise<GeniusResult> {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'error', note: 'Это не похоже на ссылку.' }
  }
  if (u.protocol !== 'https:' || !/^(?:www\.)?genius\.com$/i.test(u.hostname) || !/^\/[^/]+-lyrics\/?$/.test(u.pathname)) {
    return { ok: false, reason: 'error', note: 'Нужна ссылка на страницу песни Genius вида https://genius.com/Artist-song-lyrics' }
  }
  const url = `https://genius.com${u.pathname.replace(/\/$/, '')}`
  const r = await tryPage(url)
  if (r.text) return { ok: true, text: r.text, url }
  return r.blocked
    ? { ok: false, reason: 'blocked', note: BLOCKED_NOTE }
    : { ok: false, reason: 'notfound', note: 'По этой ссылке текста нет (страница не найдена или у песни нет текста).' }
}
