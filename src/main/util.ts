import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** Честный User-Agent: приложение не притворяется браузером. */
export const UA = 'Wave/0.1 (personal desktop music player)'

export async function fetchText(url: string, init: RequestInit & { timeout?: number } = {}): Promise<string> {
  const { timeout = 20000, headers, ...rest } = init
  const res = await fetch(url, {
    redirect: 'follow',
    ...rest,
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', ...(headers as object) },
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new HttpError(res.status, url)
  return res.text()
}

export async function fetchJson<T = any>(url: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
  const text = await fetchText(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers as object) }
  })
  return JSON.parse(text) as T
}

export async function fetchBuffer(url: string, init: RequestInit & { timeout?: number } = {}): Promise<Buffer> {
  const { timeout = 30000, headers, ...rest } = init
  const res = await fetch(url, {
    redirect: 'follow',
    ...rest,
    headers: { 'user-agent': UA, ...(headers as object) },
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new HttpError(res.status, url)
  return Buffer.from(await res.arrayBuffer())
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string
  ) {
    super(`HTTP ${status} при запросе ${new URL(url).host}`)
  }
}

/** Безопасное имя файла для всех ОС. */
export function sanitizeFilename(input: string, max = 120): string {
  let s = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  if (!s) s = 'track'
  while (Buffer.byteLength(s) > max) s = s.slice(0, -1)
  // зарезервированные имена Windows
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`
  return s
}

const NOISE_PARENS =
  /\s*[([](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visuali[sz]er)|lyric(?:s)?(?:\s*video)?|audio|video|hd|hq|4k|remaster(?:ed)?(?:\s*\d{4})?|explicit|clean|mv|m\/v|full\s*(?:song|version)|with\s*lyrics?)[)\]]/gi

/** Убирает «(Official Video)» и подобное — для красивых названий. */
export function cleanTitle(title: string): string {
  return title.replace(NOISE_PARENS, '').replace(/\s{2,}/g, ' ').trim()
}

/** Убирает (feat. …) и «- Remastered» — для поисковых запросов. */
export function stripFeat(title: string): string {
  return title
    .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|mono|stereo|single|album|radio|live|deluxe|bonus)[^-]*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function splitArtists(s: string): string[] {
  return s
    .split(/\s*(?:,|&|;|\sx\s|\sfeat\.?\s|\sft\.?\s)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean)
}

export function findInPath(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const e of exts) {
      const p = join(dir, name + e)
      try {
        if (existsSync(p) && statSync(p).isFile()) return p
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
