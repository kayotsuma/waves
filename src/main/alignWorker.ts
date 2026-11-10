/**
 * Отдельный процесс (Electron utilityProcess) для выравнивания текста по звуку.
 * Модель занимает больше гигабайта памяти и нагружает процессор, поэтому живёт отдельно от главного процесса:
 * интерфейс не подвисает, а когда работы нет, главный процесс закрывает этот процесс и память освобождается.
 */
import { constants, cpus, setPriority } from 'node:os'
import * as ort from 'onnxruntime-node'
import { buildLines, decodeForAlign, emissions, SR } from './services/align'

export type WorkerRequest = { type: 'align'; job: number; file: string; plain: string; ffmpeg: string; model: string; maxSeconds: number }
export type WorkerReply =
  | { type: 'progress'; job: number; p: number }
  | { type: 'done'; job: number; result: ReturnType<typeof buildLines> }
  | { type: 'error'; job: number; message: string }

const port = process.parentPort
// фоновая работа не должна мешать воспроизведению и интерфейсу
try {
  setPriority(constants.priority.PRIORITY_BELOW_NORMAL)
} catch {
  /* нет прав — работаем с обычным приоритетом */
}

let session: ort.InferenceSession | null = null
let sessionModel = ''

async function getSession(model: string): Promise<ort.InferenceSession> {
  if (session && sessionModel === model) return session
  await session?.release().catch(() => {})
  session = await ort.InferenceSession.create(model, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.max(1, Math.floor(cpus().length / 2)),
    interOpNumThreads: 1
  })
  sessionModel = model
  return session
}

const reply = (m: WorkerReply) => port.postMessage(m)

port.on('message', async (e) => {
  const m = e.data as WorkerRequest
  if (m?.type !== 'align') return
  try {
    const s = await getSession(m.model)
    const pcm = await decodeForAlign(m.ffmpeg, m.file, m.maxSeconds)
    if (!pcm || pcm.length < SR * 3) throw new Error('не удалось прочитать звук')
    let last = 0
    const { lp, T } = await emissions(ort, s, pcm, (p) => {
      if (p - last >= 0.1 || p >= 1) {
        last = p
        reply({ type: 'progress', job: m.job, p })
      }
    })
    reply({ type: 'done', job: m.job, result: buildLines(m.plain, lp, T) })
  } catch (err) {
    reply({ type: 'error', job: m.job, message: err instanceof Error ? err.message : String(err) })
  }
})
