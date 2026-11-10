import { spawn } from 'node:child_process'
import type { InferenceSession, Tensor } from 'onnxruntime-node'
import type { LyricLine, LyricWord } from '@shared/types'

/**
 * Выравнивание известного текста песни по аудио (CTC forced alignment).
 * Модель MMS-300M forced aligner выдаёт для каждых 20 мс звука вероятности букв латиницы; текст переводится в латиницу,
 * а алгоритм Витерби находит самый вероятный путь «буква → момент времени», при котором буквы идут строго по порядку.
 * Так время каждого слова находится по самому звуку, даже если модель «не узнаёт» слова под битом сама.
 */

export const SR = 16000
/** 320 отсчётов на кадр — 20 мс */
export const HOP = 320
const FRAME_SEC = HOP / SR

/** Словарь модели (vocab.json MahmoudAshraf/mms-300m-1130-forced-aligner) */
const VOCAB: Record<string, number> = {
  a: 4, i: 5, e: 6, n: 7, o: 8, u: 9, t: 10, s: 11, r: 12, m: 13, k: 14, l: 15, d: 16, g: 17, h: 18, y: 19,
  b: 20, p: 21, w: 22, c: 23, v: 24, j: 25, z: 26, f: 27, "'": 28, q: 29, x: 30
}
const BLANK = 0
const NV = 31

/** Кириллица → латиница (как uroman для русского и украинского) */
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u'
}

/** Слово → буквы словаря модели. Пустая строка — произнести нечем (цифры, символы). */
export function romanize(word: string): string {
  let out = ''
  for (const ch of word.toLowerCase().normalize('NFD')) {
    if (CYR[ch] !== undefined) out += CYR[ch]
    else if (VOCAB[ch] !== undefined) out += ch
    else if (ch === '’' || ch === '`') out += "'"
  }
  return out.replace(/^'+|'+$/g, '')
}

/** заголовки частей песни: [Куплет 1], (Припев) */
const SECTION = /^\s*[[(].{0,40}[\])]\s*$/

interface WordItem {
  line: number
  text: string
  /** индексы букв этого слова в общей последовательности */
  from: number
  to: number
}

/** Разбивает обычный текст на строки и слова; возвращает последовательность букв для модели. */
export function prepareText(plain: string): { lines: string[]; words: WordItem[]; tokens: number[] } {
  const lines: string[] = []
  const words: WordItem[] = []
  const tokens: number[] = []
  for (const raw of plain.split(/\r?\n/)) {
    const text = raw.trim()
    if (!text || SECTION.test(text)) continue
    const li = lines.push(text) - 1
    for (const w of text.split(/\s+/)) {
      const r = romanize(w)
      const from = tokens.length
      for (const ch of r) tokens.push(VOCAB[ch])
      words.push({ line: li, text: w, from, to: tokens.length })
    }
  }
  return { lines, words, tokens }
}

/** Декодирует трек в моно float32 16 кГц. Басы срезаются — модели нужен голос, а не бочка. */
export function decodeForAlign(ffmpeg: string, file: string, maxSeconds: number): Promise<Float32Array | null> {
  return new Promise((resolve) => {
    const p = spawn(
      ffmpeg,
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', String(SR), '-af', 'highpass=f=120', '-t', String(maxSeconds), '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', () => resolve(null))
    p.on('close', (code) => {
      if (code !== 0 || !chunks.length) return resolve(null)
      const buf = Buffer.concat(chunks)
      const out = new Float32Array(Math.floor(buf.length / 4))
      for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4)
      resolve(out)
    })
  })
}

type Ort = typeof import('onnxruntime-node')

/**
 * Лог-вероятности букв для каждого кадра. Длинный звук режется на окна по 30 с с запасом по 2 с с каждой стороны,
 * чтобы на стыках модель «слышала» контекст; от каждого окна берётся только середина.
 */
export async function emissions(ort: Ort, session: InferenceSession, pcm: Float32Array, onProgress?: (p: number) => void): Promise<{ lp: Float32Array; T: number }> {
  const WIN = 30 * SR
  const CTX = 2 * SR
  const T = Math.floor(pcm.length / HOP)
  const lp = new Float32Array(T * NV).fill(-30)
  const inName = session.inputNames[0]
  const outName = session.outputNames[0]
  for (let s = 0; s < pcm.length; s += WIN) {
    const a = Math.max(0, s - CTX)
    const b = Math.min(pcm.length, s + WIN + CTX)
    const chunk = pcm.slice(a, b)
    // нормализация окна: среднее 0, дисперсия 1
    let mean = 0
    for (let i = 0; i < chunk.length; i++) mean += chunk[i]
    mean /= chunk.length
    let v = 0
    for (let i = 0; i < chunk.length; i++) v += (chunk[i] - mean) ** 2
    const sd = Math.sqrt(v / chunk.length + 1e-7)
    for (let i = 0; i < chunk.length; i++) chunk[i] = (chunk[i] - mean) / sd
    const res = await session.run({ [inName]: new ort.Tensor('float32', chunk, [1, chunk.length]) })
    const out = res[outName] as Tensor
    const data = out.data as Float32Array
    const frames = out.dims[1] as number
    const skip = Math.round((s - a) / HOP)
    const take = Math.min(Math.round((Math.min(pcm.length, s + WIN) - s) / HOP), frames - skip)
    const base = Math.round(s / HOP)
    for (let f = 0; f < take && base + f < T; f++) {
      const src = (skip + f) * NV
      let max = -Infinity
      for (let k = 0; k < NV; k++) max = Math.max(max, data[src + k])
      let sum = 0
      for (let k = 0; k < NV; k++) sum += Math.exp(data[src + k] - max)
      const lse = max + Math.log(sum)
      const dst = (base + f) * NV
      for (let k = 0; k < NV; k++) lp[dst + k] = data[src + k] - lse
    }
    onProgress?.(Math.min(1, (s + WIN) / pcm.length))
  }
  return { lp, T }
}

/**
 * Витерби для CTC: состояния — «пусто, буква1, пусто, буква2, …, пусто».
 * Возвращает для каждой буквы первый и последний кадр и долю букв, попавших туда, где модель сама «слышит» эту букву.
 */
export function forcedAlign(lp: Float32Array, T: number, tokens: number[]): { start: Int32Array; end: Int32Array; hit: number } | null {
  const L = tokens.length
  const S = 2 * L + 1
  if (!L || T < L) return null
  if (T * S > 400_000_000) return null // слишком длинно для памяти
  const NEG = -1e30
  let prev = new Float64Array(S).fill(NEG)
  let cur = new Float64Array(S).fill(NEG)
  const back = new Uint8Array(T * S)
  const label = (s: number) => (s & 1 ? tokens[s >> 1] : BLANK)
  prev[0] = lp[BLANK]
  prev[1] = lp[tokens[0]]
  for (let t = 1; t < T; t++) {
    const row = t * NV
    // состояние s достижимо, только если на оставшиеся буквы хватит кадров
    const sMin = Math.max(0, S - 2 * (T - t) - 1)
    const sMax = Math.min(S - 1, 2 * t + 1)
    cur.fill(NEG, 0, S)
    for (let s = sMin; s <= sMax; s++) {
      let best = prev[s]
      let k = 0
      if (s > 0 && prev[s - 1] > best) {
        best = prev[s - 1]
        k = 1
      }
      if (s > 1 && s & 1 && tokens[s >> 1] !== tokens[(s >> 1) - 1] && prev[s - 2] > best) {
        best = prev[s - 2]
        k = 2
      }
      if (best <= NEG / 2) continue
      cur[s] = best + lp[row + label(s)]
      back[t * S + s] = k
    }
    const tmp = prev
    prev = cur
    cur = tmp
  }
  let s = prev[S - 1] >= prev[S - 2] ? S - 1 : S - 2
  if (prev[s] <= NEG / 2) return null
  const start = new Int32Array(L).fill(-1)
  const end = new Int32Array(L).fill(-1)
  for (let t = T - 1; t >= 0; t--) {
    if (s & 1) {
      const i = s >> 1
      if (end[i] < 0) end[i] = t
      start[i] = t
    }
    s -= back[t * S + s]
  }
  let hits = 0
  for (let i = 0; i < L; i++) {
    for (let t = start[i]; t <= end[i]; t++) {
      let m = -Infinity
      for (let k = 4; k < NV; k++) m = Math.max(m, lp[t * NV + k])
      if (lp[t * NV + tokens[i]] >= m - 1) {
        hits++
        break
      }
    }
  }
  return { start, end, hit: hits / L }
}

export interface AlignResult {
  lines: LyricLine[]
  /**
   * Насколько текст подходит к звуку: доля «попавших» букв минус то же для текста задом наперёд (те же буквы, неверный порядок).
   * На проверке: у текста этой песни ≥ 0.10, у текста другой песни ≤ 0.065.
   */
  match: number
}

/** Ниже — текст, скорее всего, от другой песни (или звук слишком неразборчив): выравниванию не верим. */
export const MIN_MATCH = 0.08

/** Собирает строки с временем строки и каждого слова. Слова без букв (цифры) получают время соседей. */
export function buildLines(plain: string, lp: Float32Array, T: number, lead = 0.1): AlignResult | null {
  const { lines, words, tokens } = prepareText(plain)
  if (!lines.length || tokens.length < 4) return null
  const al = forcedAlign(lp, T, tokens)
  if (!al) return null
  const reversed = forcedAlign(lp, T, [...tokens].reverse())
  const match = al.hit - (reversed?.hit ?? 0)

  const wStart: number[] = []
  const wEnd: number[] = []
  for (const w of words) {
    if (w.to > w.from) {
      // строку и слово показываем чуть раньше голоса — так караоке читается естественнее
      wStart.push(Math.max(0, al.start[w.from] * FRAME_SEC - lead))
      wEnd.push((al.end[w.to - 1] + 1) * FRAME_SEC)
    } else {
      wStart.push(NaN)
      wEnd.push(NaN)
    }
  }
  // слова без букв: между концом предыдущего и началом следующего
  for (let i = 0; i < words.length; i++) {
    if (!Number.isNaN(wStart[i])) continue
    let p = i - 1
    while (p >= 0 && Number.isNaN(wEnd[p])) p--
    let q = i + 1
    while (q < words.length && Number.isNaN(wStart[q])) q++
    const a = p >= 0 ? wEnd[p] : q < words.length ? Math.max(0, wStart[q] - 0.4) : 0
    const b = q < words.length ? wStart[q] : a + 0.4
    wStart[i] = a
    wEnd[i] = Math.max(a, b)
  }
  const out: LyricLine[] = []
  const r2 = (x: number) => Math.round(x * 100) / 100
  let prevEnd = 0
  for (let li = 0; li < lines.length; li++) {
    const idx: number[] = []
    words.forEach((w, i) => w.line === li && idx.push(i))
    if (!idx.length) continue
    const ws: LyricWord[] = idx.map((i, k) => ({ t: r2(wStart[i]), text: words[i].text + (k < idx.length - 1 ? ' ' : '') }))
    const t = ws[0].t
    // длинная пауза после предыдущей строки — пустая строка (проигрыш)
    if (out.length && t - prevEnd > 6) out.push({ t: r2(prevEnd + 0.6), text: '' })
    out.push({ t, text: lines[li], words: ws })
    prevEnd = wEnd[idx[idx.length - 1]]
  }
  return { lines: out, match }
}
