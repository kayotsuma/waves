import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { net, utilityProcess, type UtilityProcess } from 'electron'
import type { AlignStatus } from '@shared/types'
import type { WorkerReply, WorkerRequest } from '../alignWorker'
import type { LibraryService } from '../library'
import { dataDir } from '../paths'
import type { SettingsService } from '../settings'
import type { Binaries } from './binaries'
import type { LyricsService } from './lyrics'

/**
 * Модель MMS-300M forced aligner (Meta MMS, конвертация в ONNX от deskpai, fp32). Лицензия CC-BY-NC 4.0 —
 * подходит для личного некоммерческого плеера. Качается один раз, проверяется по SHA-256.
 */
const MODEL = {
  url: 'https://huggingface.co/deskpai/ctc_forced_aligner/resolve/main/04ac86b67129634da93aea76e0147ef3.onnx',
  sha256: 'e8bad67fd3533b3d3c145b0ca31bb15383945c13384dd8975baaa7b73f7b61ac',
  size: 1_262_421_764,
  file: 'mms-300m-fa-fp32.onnx'
}
/** длиннее не выравниваем: долго и не хватит памяти на таблицу Витерби */
const MAX_SECONDS = 15 * 60
/** через столько простоя процесс с моделью закрывается, чтобы вернуть память */
const IDLE_MS = 90_000

export const plainHash = (plain: string) => createHash('sha1').update(plain.trim()).digest('hex').slice(0, 16)

export class AlignerService {
  onStatus: (s: AlignStatus) => void = () => {}
  /** у трека появилась синхронизация по звуку */
  onAligned: (trackId: string) => void = () => {}

  private queue: string[] = []
  private current: string | null = null
  private currentProgress = 0
  private busy = false
  private done = 0
  private failed = new Set<string>()
  private model: AlignStatus['model']
  private progress = 0
  private error?: string
  private download: Promise<boolean> | null = null
  private failedAt = 0
  private worker: UtilityProcess | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private job = 0
  private pending = new Map<number, { resolve: (r: WorkerReply) => void; onProgress: (p: number) => void }>()

  constructor(
    private lib: LibraryService,
    private lyrics: LyricsService,
    private bins: Binaries,
    private settings: SettingsService
  ) {
    this.model = existsSync(this.modelPath) ? 'ready' : 'missing'
  }

  private get modelPath(): string {
    return join(dataDir(), 'models', MODEL.file)
  }

  private get enabled(): boolean {
    return this.settings.get().download.alignLyrics !== false
  }

  status(): AlignStatus {
    return {
      enabled: this.enabled,
      model: this.model,
      progress: this.model === 'downloading' ? this.progress : undefined,
      error: this.error,
      queue: this.queue.length,
      queued: this.queue.slice(0, 200),
      current: this.current ?? undefined,
      currentProgress: this.current ? this.currentProgress : undefined,
      done: this.done
    }
  }

  private emit(): void {
    this.onStatus(this.status())
  }

  /** Нужна ли треку синхронизация по звуку: текст есть, точной синхронизации нет, этот текст ещё не пробовали. */
  needs(id: string): boolean {
    const t = this.lib.get(id)
    if (!t || t.missing || t.remote || !(t.duration > 5) || t.duration > MAX_SECONDS || this.failed.has(id)) return false
    const d = this.lyrics.get(id)
    if (!d?.plain?.trim()) return false
    if (d.synced?.length && d.syncedSource !== 'estimated') return false
    return d.alignAttempt?.plainHash !== plainHash(d.plain)
  }

  /** Поставить трек в очередь; urgent — тот, что сейчас открыт у пользователя, идёт первым. */
  enqueue(id: string, urgent = false): void {
    if (!this.enabled || this.current === id || !this.needs(id)) return
    const at = this.queue.indexOf(id)
    if (at >= 0) {
      if (!urgent) return
      this.queue.splice(at, 1)
    }
    if (urgent) this.queue.unshift(id)
    else this.queue.push(id)
    this.emit()
    void this.pump()
  }

  /** Все треки медиатеки, которым нужна синхронизация. */
  enqueueLibrary(): void {
    if (!this.enabled) return
    for (const t of this.lib.snapshot().tracks) this.enqueue(t.id)
  }

  startBackground(delayMs = 30_000): void {
    setTimeout(() => this.enqueueLibrary(), delayMs).unref?.()
  }

  /** Выключили в настройках: очередь очищается, процесс с моделью закрывается. */
  setEnabled(on: boolean): void {
    if (on) this.enqueueLibrary()
    else {
      this.queue = []
      this.stopWorker()
    }
    this.emit()
  }

  stop(): void {
    this.queue = []
    this.stopWorker()
  }

  private async pump(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queue.length && this.enabled) {
        if (!(await this.ensureModel())) break
        const id = this.queue.shift()!
        if (!this.needs(id)) continue
        this.current = id
        this.currentProgress = 0
        this.emit()
        try {
          await this.alignTrack(id)
        } catch (e) {
          console.warn('[align]', id, e instanceof Error ? e.message : e)
          this.failed.add(id)
        }
        this.current = null
        this.emit()
        await new Promise((r) => setTimeout(r, 500))
      }
    } finally {
      this.busy = false
      this.current = null
      this.scheduleIdle()
      this.emit()
    }
  }

  private async alignTrack(id: string): Promise<void> {
    const t = this.lib.get(id)
    const d = this.lyrics.get(id)
    const ffmpeg = this.bins.ffmpegPath
    if (!t || !d?.plain || !ffmpeg || !existsSync(t.file)) {
      this.failed.add(id)
      return
    }
    const plain = d.plain
    const r = await this.send({ type: 'align', job: 0, file: t.file, plain, ffmpeg, model: this.modelPath, maxSeconds: MAX_SECONDS }, (p) => {
      this.currentProgress = p
      this.emit()
    })
    if (r.type === 'error') throw new Error(r.message)
    if (r.type !== 'done') return
    const applied = this.lyrics.setAligned(id, plain, plainHash(plain), r.result)
    if (applied) {
      this.done++
      this.onAligned(id)
    }
  }

  // ───── процесс с моделью ─────

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker
    const w = utilityProcess.fork(join(__dirname, 'alignWorker.js'), [], { serviceName: 'Wave: синхронизация текста', stdio: 'inherit' })
    w.on('message', (m: WorkerReply) => {
      const p = this.pending.get(m.job)
      if (!p) return
      if (m.type === 'progress') p.onProgress(m.p)
      else {
        this.pending.delete(m.job)
        p.resolve(m)
      }
    })
    w.on('exit', (code) => {
      if (this.worker === w) this.worker = null
      // процесс упал посреди работы — задачи завершаются ошибкой, очередь продолжится
      for (const [job, p] of this.pending) p.resolve({ type: 'error', job, message: `процесс выравнивания завершился (код ${code})` })
      this.pending.clear()
    })
    this.worker = w
    return w
  }

  private send(req: WorkerRequest, onProgress: (p: number) => void): Promise<WorkerReply> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const job = ++this.job
    return new Promise((resolve) => {
      this.pending.set(job, { resolve, onProgress })
      this.ensureWorker().postMessage({ ...req, job })
    })
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stopWorker(), IDLE_MS)
    this.idleTimer.unref?.()
  }

  private stopWorker(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.worker?.kill()
    this.worker = null
  }

  // ───── модель ─────

  /** Скачивает модель при первой надобности. false — скачать не вышло (повторим при следующем запуске очереди). */
  private ensureModel(): Promise<boolean> {
    if (this.model === 'ready' && existsSync(this.modelPath)) return Promise.resolve(true)
    // после неудачи (нет сети) не пытаемся снова на каждом треке — подождём 10 минут
    if (this.model === 'error' && Date.now() - this.failedAt < 10 * 60_000) return Promise.resolve(false)
    this.download ??= this.fetchModel().finally(() => (this.download = null))
    return this.download
  }

  private async fetchModel(): Promise<boolean> {
    const dir = join(dataDir(), 'models')
    mkdirSync(dir, { recursive: true })
    const part = `${this.modelPath}.part`
    this.model = 'downloading'
    this.progress = 0
    this.error = undefined
    this.emit()
    try {
      const res = await net.fetch(MODEL.url)
      if (!res.ok || !res.body) throw new Error(`сервер ответил ${res.status}`)
      const total = Number(res.headers.get('content-length')) || MODEL.size
      const hash = createHash('sha256')
      const out = createWriteStream(part)
      const reader = res.body.getReader()
      let got = 0
      let shown = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        got += value.length
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        if (got - shown > 8_000_000) {
          shown = got
          this.progress = got / total
          this.emit()
        }
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
      if (hash.digest('hex') !== MODEL.sha256) throw new Error('файл модели повреждён (не совпала контрольная сумма)')
      renameSync(part, this.modelPath)
      this.model = 'ready'
      this.emit()
      return true
    } catch (e) {
      rmSync(part, { force: true })
      this.model = 'error'
      this.failedAt = Date.now()
      this.error = e instanceof Error ? e.message : String(e)
      console.warn('[align] модель:', this.error)
      this.emit()
      return false
    }
  }
}
