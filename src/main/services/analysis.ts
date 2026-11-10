import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SimilarTrack, Track, TrackAnalysis } from '@shared/types'
import type { LibraryService } from '../library'
import { analysisDir } from '../paths'
import type { Binaries } from './binaries'
import { ANALYSIS_SR, analyzePcm, camelot } from './analysisDsp'
import { decodePcm, measureLoudness } from './ffmpeg'

const VERSION = 1
/** Дольше — не анализируем (подкасты, миксы на часы): долго и не нужно. */
const MAX_SECONDS = 1800

const clamp = (x: number, a = 0, b = 100) => Math.min(b, Math.max(a, x))

/**
 * Анализ треков: волна для перемотки, темп, тональность, характер звучания.
 * Результаты кэшируются в userData/analysis/<id>.json; считаются по одному, чтобы не нагружать систему.
 */
export class AnalysisService {
  private cache = new Map<string, TrackAnalysis>()
  private inflight = new Map<string, Promise<TrackAnalysis | null>>()
  /** то, что не удалось проанализировать за эту сессию (чтобы не повторять бесконечно) */
  private failed = new Set<string>()
  private queue: string[] = []
  private urgent: Array<() => void> = []
  private busy = false
  private bgTimer: NodeJS.Timeout | null = null

  constructor(
    private lib: LibraryService,
    private bins: Binaries
  ) {
    mkdirSync(analysisDir(), { recursive: true })
    for (const f of readdirSync(analysisDir())) {
      if (!f.endsWith('.json')) continue
      const id = f.slice(0, -5)
      if (!this.lib.get(id)) {
        rmSync(join(analysisDir(), f), { force: true }) // трек удалён
        continue
      }
      try {
        const a = JSON.parse(readFileSync(join(analysisDir(), f), 'utf8')) as TrackAnalysis
        if (a.v === VERSION && Array.isArray(a.peaks)) this.cache.set(id, a)
      } catch {
        /* повреждённый файл пересчитается */
      }
    }
  }

  /** Запускает фоновый анализ всей библиотеки (с задержкой, чтобы не мешать старту). */
  startBackground(delayMs = 20_000): void {
    this.bgTimer = setTimeout(() => this.enqueueMissing(), delayMs)
    this.bgTimer.unref?.()
  }

  stop(): void {
    if (this.bgTimer) clearTimeout(this.bgTimer)
    this.queue = []
  }

  enqueueMissing(): void {
    for (const t of this.lib.snapshot().tracks) this.enqueue(t.id)
  }

  /** Новый трек в библиотеке: поставить в очередь фонового анализа. */
  enqueue(id: string): void {
    if (this.cache.has(id) || this.failed.has(id) || this.queue.includes(id) || this.inflight.has(id)) return
    const t = this.lib.get(id)
    if (!t || t.missing || t.duration > MAX_SECONDS) return
    this.queue.push(id)
    void this.pump()
  }

  /** Анализ трека: из кэша или сразу (вне очереди фоновых задач). */
  async get(id: string): Promise<TrackAnalysis | null> {
    const hit = this.cache.get(id)
    if (hit) return hit
    const t = this.lib.get(id)
    if (!t || t.missing || t.duration > MAX_SECONDS || this.failed.has(id)) return null
    const running = this.inflight.get(id)
    if (running) return running
    // запрошенный пользователем трек обгоняет фоновую очередь
    this.queue = this.queue.filter((x) => x !== id)
    return this.run(id)
  }

  private run(id: string): Promise<TrackAnalysis | null> {
    const p = this.compute(id)
      .then((a) => {
        if (a) {
          this.cache.set(id, a)
          this.save(id, a)
        } else if (a === null) this.failed.add(id)
        return a ?? null
      })
      .catch((e) => {
        console.error('[analysis]', id, e)
        this.failed.add(id)
        return null
      })
      .finally(() => this.inflight.delete(id))
    this.inflight.set(id, p)
    return p
  }

  private async pump(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!
        if (this.cache.has(id) || this.inflight.has(id)) continue
        await this.run(id)
        await new Promise((r) => setTimeout(r, 150)) // небольшая пауза между треками
      }
    } finally {
      this.busy = false
    }
  }

  private save(id: string, a: TrackAnalysis): void {
    try {
      const file = join(analysisDir(), `${id}.json`)
      writeFileSync(`${file}.tmp`, JSON.stringify(a))
      renameSync(`${file}.tmp`, file)
    } catch (e) {
      console.error('[analysis] не удалось сохранить', e)
    }
  }

  /** undefined — ffmpeg пока недоступен (повторим позже), null — трек проанализировать нельзя. */
  private async compute(id: string): Promise<TrackAnalysis | null | undefined> {
    const t = this.lib.get(id)
    const ffmpeg = this.bins.ffmpegPath
    if (!ffmpeg) return undefined
    if (!t || !existsSync(t.file)) return null

    const raw = await decodePcm(ffmpeg, t.file, ANALYSIS_SR, MAX_SECONDS)
    if (!raw || raw.length < ANALYSIS_SR * 2) return null
    const pcm = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 2)))
    const dsp = await analyzePcm(pcm)

    let loudness = t.loudness
    let peak = t.peak
    if (loudness == null || peak == null) {
      const m = await measureLoudness(ffmpeg, t.file).catch(() => ({}) as { loudness?: number; peak?: number })
      loudness = loudness ?? m.loudness
      peak = peak ?? m.peak
    }
    const dynamics = loudness != null && peak != null ? Math.max(0, +(peak - loudness).toFixed(1)) : undefined

    // «энергия»: громкость + ритмическая активность + яркость (эвристика)
    const lufs = loudness ?? dsp.rmsDb + 3
    const loudScore = clamp(((lufs + 24) / 18) * 100)
    const energy = Math.round(0.45 * loudScore + 0.35 * dsp.rhythm + 0.2 * dsp.brightness)

    return {
      v: VERSION,
      peaks: dsp.peaks,
      bpm: dsp.bpm,
      bpmConfidence: dsp.bpmConfidence != null ? +dsp.bpmConfidence.toFixed(2) : undefined,
      key: dsp.key ? { ...dsp.key, confidence: +dsp.key.confidence.toFixed(2), camelot: camelot(dsp.key.tonic, dsp.key.mode) } : undefined,
      loudness,
      peak,
      dynamics,
      energy,
      bass: dsp.bass,
      vocal: dsp.vocal,
      brightness: dsp.brightness
    }
  }

  /** Похожие треки среди уже проанализированных: темп, тональность (по кругу Camelot), тембр, энергия. */
  similar(id: string, limit = 8): SimilarTrack[] {
    const a = this.cache.get(id)
    if (!a) return []
    const out: SimilarTrack[] = []
    for (const [otherId, b] of this.cache) {
      if (otherId === id) continue
      const t: Track | undefined = this.lib.get(otherId)
      if (!t || t.missing) continue
      out.push({ trackId: otherId, score: Math.round(similarity(a, b) * 100) })
    }
    return out.sort((x, y) => y.score - x.score).slice(0, limit)
  }
}

export function similarity(a: TrackAnalysis, b: TrackAnalysis): number {
  // темп: расстояние в октавах, удвоение/половина считаются близкими
  let tempo = 0.5
  if (a.bpm && b.bpm) {
    const r = Math.log2(a.bpm / b.bpm)
    tempo = 1 - Math.min(1, Math.abs(r - Math.round(r)) * 4)
  }
  // тональность: шаги по кругу Camelot (соседи гармонично сочетаются)
  let key = 0.4
  if (a.key && b.key) {
    const na = parseInt(a.key.camelot, 10)
    const nb = parseInt(b.key.camelot, 10)
    const ring = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12)
    const modeDiff = a.key.mode === b.key.mode ? 0 : ring === 0 ? 1 : 2 // относительные (8A↔8B) — почти то же
    key = Math.max(0, 1 - (ring + modeDiff) / 6)
  }
  const dist = Math.hypot(a.bass - b.bass, a.vocal - b.vocal, a.brightness - b.brightness) / Math.sqrt(3 * 100 * 100)
  const timbre = 1 - dist * 1.6
  const energy = 1 - Math.abs(a.energy - b.energy) / 100
  return Math.max(0, Math.min(1, 0.25 * tempo + 0.25 * key + 0.3 * Math.max(0, timbre) + 0.2 * energy))
}
