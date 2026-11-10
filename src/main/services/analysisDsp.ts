// Анализ звука: волна, темп, тональность, «характер» звучания. Чистая математика без Electron —
// принимает моно-PCM и возвращает числа, поэтому легко проверяется отдельно.
//
// Все оценки приблизительные (как у любого автоматического анализа): темп и тональность хорошо
// работают на ритмичной/тональной музыке и могут ошибаться на ambient, speech и сложных размерах.

export const ANALYSIS_SR = 22050
const N = 2048 // окно FFT
const HOP = 512
const BINS = N / 2

export interface DspResult {
  /** огибающая для полосы перемотки, 0..100 */
  peaks: number[]
  bpm?: number
  /** 0..1 — насколько оценка темпа выделяется на фоне альтернатив */
  bpmConfidence?: number
  key?: { tonic: number; mode: 'major' | 'minor'; confidence: number }
  /** 0..100 */
  bass: number
  vocal: number
  brightness: number
  rhythm: number
  /** средний уровень, дБFS по мощности (грубая замена громкости, если её не измерили) */
  rmsDb: number
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r))
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

// ───── FFT (radix-2, на месте) ─────

const rev = new Uint16Array(N)
const cosT = new Float32Array(N / 2)
const sinT = new Float32Array(N / 2)
const hann = new Float32Array(N)
{
  const bits = Math.log2(N)
  for (let i = 0; i < N; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
    rev[i] = r
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  }
  for (let i = 0; i < N / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / N)
    sinT[i] = -Math.sin((2 * Math.PI * i) / N)
  }
}

function fft(re: Float32Array, im: Float32Array): void {
  for (let i = 0; i < N; i++) {
    const j = rev[i]
    if (j > i) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1
    const step = N / size
    for (let start = 0; start < N; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = start + k
        const b = a + half
        const xr = re[b] * cosT[t] - im[b] * sinT[t]
        const xi = re[b] * sinT[t] + im[b] * cosT[t]
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

// ───── волна ─────

function waveform(pcm: Int16Array, buckets: number): number[] {
  const out = new Float64Array(buckets)
  const per = pcm.length / buckets
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per)
    const to = Math.max(from + 1, Math.min(pcm.length, Math.floor((b + 1) * per)))
    let peak = 0
    let sum = 0
    for (let i = from; i < to; i++) {
      const v = Math.abs(pcm[i]) / 32768
      if (v > peak) peak = v
      sum += v * v
    }
    const rms = Math.sqrt(sum / (to - from))
    out[b] = 0.65 * rms * 1.6 + 0.35 * peak
  }
  // нормируем по 97-му перцентилю, чтобы одиночные пики не «сплющивали» картинку
  const sorted = Float64Array.from(out).sort()
  const ref = Math.max(1e-4, sorted[Math.min(buckets - 1, Math.floor(buckets * 0.97))])
  return Array.from(out, (v) => Math.round(Math.pow(clamp(v / ref), 0.85) * 100))
}

// ───── темп ─────

function estimateBpm(onset: Float32Array, fps: number): { bpm?: number; confidence: number } {
  // берём середину трека (до 3 минут): интро и аутро обычно не показательны
  const maxLen = Math.floor(fps * 180)
  let o = onset
  if (o.length > maxLen) {
    const s = Math.floor((o.length - maxLen) / 2)
    o = o.subarray(s, s + maxLen)
  }
  if (o.length < fps * 6) return { confidence: 0 }

  // убираем медленно меняющуюся составляющую и отрицательные значения
  const w = Math.round(fps * 0.4)
  const env = new Float32Array(o.length)
  let acc = 0
  for (let i = 0; i < o.length; i++) {
    acc += o[i]
    if (i >= 2 * w + 1) acc -= o[i - 2 * w - 1]
    const c = i - w
    if (c >= 0) {
      const cnt = Math.min(c + w, o.length - 1) - Math.max(0, c - w) + 1
      env[c] = Math.max(0, o[c] - acc / Math.min(cnt, 2 * w + 1))
    }
  }
  let mean = 0
  for (const v of env) mean += v
  mean /= env.length
  if (mean < 1e-6) return { confidence: 0 }
  for (let i = 0; i < env.length; i++) env[i] = env[i] / mean - 1

  const minBpm = 60
  const maxBpm = 200
  const maxLag = Math.ceil((fps * 60 * 4) / minBpm) + 2
  const acf = new Float32Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag]
    acf[lag] = s / (env.length - lag)
  }
  if (acf[0] <= 0) return { confidence: 0 }
  const at = (lag: number) => {
    const i = Math.floor(lag)
    if (i + 1 > maxLag) return 0
    const f = lag - i
    return (acf[i] * (1 - f) + acf[i + 1] * f) / acf[0]
  }

  const scores: { bpm: number; s: number }[] = []
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const L = (fps * 60) / bpm
    // сам период + кратные доли такта (2L, 4L) подтверждают темп
    let s = at(L) + 0.5 * at(2 * L) + 0.25 * at(4 * L)
    // мягкое предпочтение «человеческого» диапазона вокруг 120 BPM
    const oct = Math.log2(bpm / 120)
    s *= Math.exp(-(oct * oct) / (2 * 0.8 * 0.8))
    scores.push({ bpm, s })
  }
  let best = scores[0]
  for (const x of scores) if (x.s > best.s) best = x
  if (best.s <= 0) return { confidence: 0 }
  // следующий по силе пик не рядом с лучшим (дальше ±8%)
  let second = 0
  for (const x of scores) if (Math.abs(x.bpm / best.bpm - 1) > 0.08 && x.s > second) second = x.s
  const confidence = clamp(1 - second / best.s)
  // параболическое уточнение вокруг пика не нужно: шаг сетки 0.25 BPM
  return { bpm: Math.round(best.bpm * 2) / 2, confidence }
}

// ───── тональность (Krumhansl–Schmuckler) ─────

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0
  let mb = 0
  for (let i = 0; i < 12; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= 12
  mb /= 12
  let n = 0
  let da = 0
  let db = 0
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0
}

function estimateKey(chroma: Float64Array): DspResult['key'] {
  let total = 0
  for (const v of chroma) total += v
  if (total <= 0) return undefined
  const cands: { tonic: number; mode: 'major' | 'minor'; r: number }[] = []
  for (let t = 0; t < 12; t++) {
    const rot = new Float64Array(12)
    for (let i = 0; i < 12; i++) rot[i] = chroma[(i + t) % 12]
    cands.push({ tonic: t, mode: 'major', r: corr(rot, MAJOR) }, { tonic: t, mode: 'minor', r: corr(rot, MINOR) })
  }
  cands.sort((a, b) => b.r - a.r)
  const [a, b] = cands
  // уверенность: отрыв от лучшего из «чужих» кандидатов (родственная тональность не считается)
  const rival = cands.find((c) => !(c.tonic === a.tonic && c.mode === a.mode) && !isRelative(a, c)) ?? b
  return { tonic: a.tonic, mode: a.mode, confidence: clamp((a.r - rival.r) * 5) }
}

const isRelative = (a: { tonic: number; mode: string }, b: { tonic: number; mode: string }) =>
  a.mode !== b.mode && (a.mode === 'major' ? (a.tonic + 9) % 12 === b.tonic : (a.tonic + 3) % 12 === b.tonic)

// ───── основной проход ─────

/** pcm — моно Int16 на частоте ANALYSIS_SR. */
export async function analyzePcm(pcm: Int16Array, buckets = 720): Promise<DspResult> {
  const sr = ANALYSIS_SR
  const frames = Math.max(0, Math.floor((pcm.length - N) / HOP) + 1)
  const peaks = waveform(pcm, buckets)
  const empty: DspResult = { peaks, bass: 0, vocal: 0, brightness: 0, rhythm: 0, rmsDb: -90 }
  if (frames < 8) return empty

  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const mag = new Float32Array(BINS)
  const prevLog = new Float32Array(BINS)
  const onset = new Float32Array(frames)
  const chroma = new Float64Array(12)
  const fr = new Float64Array(12)
  const pcOfBin = new Int8Array(BINS).fill(-1)
  const binHz = sr / N
  for (let k = 1; k < BINS; k++) {
    const f = k * binHz
    if (f >= 100 && f <= 2000) pcOfBin[k] = (((Math.round(12 * Math.log2(f / 440)) + 69) % 12) + 12) % 12
  }
  const bin = (hz: number) => Math.round(hz / binHz)
  const b20 = bin(20)
  const b150 = bin(150)
  const b300 = bin(300)
  const b3400 = bin(3400)
  const b30 = bin(30)
  const b8k = bin(8000)

  let pBass = 0
  let pMid = 0
  let pHigh = 0
  let pAll = 0
  let centroidSum = 0
  let centroidW = 0
  let sumSq = 0

  for (let f = 0; f < frames; f++) {
    if (f % 96 === 0) await yieldLoop()
    const off = f * HOP
    for (let i = 0; i < N; i++) {
      const v = pcm[off + i] / 32768
      re[i] = v * hann[i]
      im[i] = 0
      sumSq += v * v
    }
    fft(re, im)
    let frameP = 0
    let flux = 0
    let cNum = 0
    let cDen = 0
    for (let k = 1; k < BINS; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      mag[k] = m
      const p = m * m
      if (k >= b20) {
        frameP += p
        pAll += p
        if (k <= b150) pBass += p
        else if (k >= b300 && k <= b3400) pMid += p
        else if (k > b3400) pHigh += p
        cNum += k * binHz * m
        cDen += m
      }
      const lg = Math.log1p(m * 40)
      if (k >= b30 && k <= b8k) {
        const d = lg - prevLog[k]
        if (d > 0) flux += d
      }
      prevLog[k] = lg
    }
    onset[f] = f === 0 ? 0 : flux
    if (cDen > 1e-3) {
      centroidSum += (cNum / cDen) * frameP
      centroidW += frameP
    }

    // хрома: только локальные максимумы спектра (шум и «грязь» между пиками отбрасываем)
    let maxMag = 0
    for (let k = 1; k < BINS; k++) if (pcOfBin[k] >= 0 && mag[k] > maxMag) maxMag = mag[k]
    if (maxMag > 0.02) {
      const thr = maxMag * 0.12
      let fsum = 0
      fr.fill(0)
      for (let k = 2; k < BINS - 1; k++) {
        const pc = pcOfBin[k]
        if (pc < 0 || mag[k] < thr || mag[k] < mag[k - 1] || mag[k] < mag[k + 1]) continue
        const v = Math.sqrt(mag[k])
        fr[pc] += v
        fsum += v
      }
      if (fsum > 0) for (let i = 0; i < 12; i++) chroma[i] += fr[i] / fsum
    }
  }

  const fps = sr / HOP
  const tempo = estimateBpm(onset, fps)
  const key = estimateKey(chroma)

  // «характер»: доли мощности по полосам → шкала 0..100 (границы подобраны по типичной музыке)
  const share = (p: number) => (pAll > 0 ? p / pAll : 0)
  const db = (x: number) => 10 * Math.log10(Math.max(1e-9, x))
  const scale = (v: number, lo: number, hi: number) => Math.round(clamp((v - lo) / (hi - lo)) * 100)
  const centroid = centroidW > 0 ? centroidSum / centroidW : 0

  // ритмическая активность: доля кадров с заметным всплеском
  let meanOnset = 0
  for (const v of onset) meanOnset += v
  meanOnset /= onset.length
  let hits = 0
  for (let i = 1; i < onset.length - 1; i++) if (onset[i] > meanOnset * 1.6 && onset[i] >= onset[i - 1] && onset[i] >= onset[i + 1]) hits++
  const perSec = hits / (onset.length / fps)

  return {
    peaks,
    bpm: tempo.bpm,
    bpmConfidence: tempo.bpm ? tempo.confidence : undefined,
    key,
    bass: scale(db(share(pBass)), -12, -1.5),
    vocal: scale(db(share(pMid)), -14, -2.5),
    brightness: centroid > 0 ? scale(Math.log(centroid), Math.log(450), Math.log(4500)) : 0,
    rhythm: scale(perSec, 0.4, 5),
    rmsDb: db(sumSq / (frames * N))
  }
}

// ───── Camelot и названия ─────

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function camelot(tonic: number, mode: 'major' | 'minor'): string {
  const majorTonic = mode === 'major' ? tonic : (tonic + 3) % 12
  const n = ((majorTonic * 7) % 12 + 7) % 12 + 1
  return `${n}${mode === 'major' ? 'B' : 'A'}`
}
