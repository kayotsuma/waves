/**
 * Звуковые эффекты на чистом Web Audio (без AudioWorklet — он упирается в CSP).
 */

/** Кривая дисторшна: amount 0..1 → мягкий овердрайв → жёсткий клип. */
export function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048
  const k = 1 + amount * 60
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}

/** Синтетический импульс комнаты: стерео-шум с экспоненциальным затуханием и мягким срезом верхов. */
export function makeImpulse(ctx: BaseAudioContext, decay: number): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.max(1, Math.floor(sr * Math.max(0.2, decay)))
  const buf = ctx.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      // верха затухают быстрее низов — как в настоящем помещении
      const a = 0.25 + 0.7 * (1 - t)
      lp += a * ((Math.random() * 2 - 1) - lp)
      d[i] = lp * (1 - t) ** 2.6 * (i < sr * 0.012 ? i / (sr * 0.012) : 1)
    }
  }
  return buf
}

/**
 * Питч-шифтер «две линии задержки с пилой» (Chris Wilson, Jungle): сдвигает тон, не меняя темп.
 * Для небольших сдвигов (±12 полутонов) звучит прилично; на больших появляется лёгкий «хорус».
 */
export class PitchShifter {
  readonly input: GainNode
  readonly output: GainNode
  private mod1Gain: GainNode
  private mod2Gain: GainNode
  private mod3Gain: GainNode
  private mod4Gain: GainNode
  private modGain1: GainNode
  private modGain2: GainNode
  private ctx: BaseAudioContext
  private readonly delayTime = 0.1

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    const bufferTime = 0.1
    const fadeTime = 0.05

    const fadeBuf = this.fadeBuffer(bufferTime, fadeTime)
    const downBuf = this.delayBuffer(bufferTime, fadeTime, false)
    const upBuf = this.delayBuffer(bufferTime, fadeTime, true)

    this.input = ctx.createGain()
    this.output = ctx.createGain()
    const src = (buffer: AudioBuffer) => {
      const s = ctx.createBufferSource()
      s.buffer = buffer
      s.loop = true
      return s
    }
    const mod1 = src(downBuf)
    const mod2 = src(downBuf)
    const mod3 = src(upBuf)
    const mod4 = src(upBuf)
    this.mod1Gain = ctx.createGain()
    this.mod2Gain = ctx.createGain()
    this.mod3Gain = ctx.createGain()
    this.mod4Gain = ctx.createGain()
    this.mod3Gain.gain.value = 0
    this.mod4Gain.gain.value = 0
    mod1.connect(this.mod1Gain)
    mod2.connect(this.mod2Gain)
    mod3.connect(this.mod3Gain)
    mod4.connect(this.mod4Gain)

    this.modGain1 = ctx.createGain()
    this.modGain2 = ctx.createGain()
    const delay1 = ctx.createDelay(1)
    const delay2 = ctx.createDelay(1)
    this.mod1Gain.connect(this.modGain1)
    this.mod2Gain.connect(this.modGain2)
    this.mod3Gain.connect(this.modGain1)
    this.mod4Gain.connect(this.modGain2)
    this.modGain1.connect(delay1.delayTime)
    this.modGain2.connect(delay2.delayTime)

    const fade1 = src(fadeBuf)
    const fade2 = src(fadeBuf)
    const mix1 = ctx.createGain()
    const mix2 = ctx.createGain()
    mix1.gain.value = 0
    mix2.gain.value = 0
    fade1.connect(mix1.gain)
    fade2.connect(mix2.gain)

    this.input.connect(delay1)
    this.input.connect(delay2)
    delay1.connect(mix1)
    delay2.connect(mix2)
    mix1.connect(this.output)
    mix2.connect(this.output)

    const t = ctx.currentTime + 0.05
    const t2 = t + bufferTime - fadeTime
    mod1.start(t)
    mod2.start(t2)
    mod3.start(t)
    mod4.start(t2)
    fade1.start(t)
    fade2.start(t2)
    this.setSemitones(0)
  }

  /** Сдвиг тона в полутонах (−12…+12). */
  setSemitones(st: number): void {
    const ratio = 2 ** (st / 12)
    const mult = 2 * (ratio - 1) // знак — направление, модуль — величина
    const up = mult > 0
    const t = this.ctx.currentTime
    this.mod1Gain.gain.setTargetAtTime(up ? 0 : 1, t, 0.01)
    this.mod2Gain.gain.setTargetAtTime(up ? 0 : 1, t, 0.01)
    this.mod3Gain.gain.setTargetAtTime(up ? 1 : 0, t, 0.01)
    this.mod4Gain.gain.setTargetAtTime(up ? 1 : 0, t, 0.01)
    const g = 0.5 * this.delayTime * Math.abs(mult)
    this.modGain1.gain.setTargetAtTime(g, t, 0.01)
    this.modGain2.gain.setTargetAtTime(g, t, 0.01)
  }

  private fadeBuffer(activeTime: number, fadeTime: number): AudioBuffer {
    const sr = this.ctx.sampleRate
    const l1 = Math.floor(activeTime * sr)
    const l2 = Math.floor((activeTime - 2 * fadeTime) * sr)
    const buf = this.ctx.createBuffer(1, l1 + l2, sr)
    const p = buf.getChannelData(0)
    const fl = fadeTime * sr
    const f2 = l1 - fl
    for (let i = 0; i < l1; i++) p[i] = i < fl ? Math.sqrt(i / fl) : i >= f2 ? Math.sqrt(1 - (i - f2) / fl) : 1
    return buf
  }

  private delayBuffer(activeTime: number, fadeTime: number, shiftUp: boolean): AudioBuffer {
    const sr = this.ctx.sampleRate
    const l1 = Math.floor(activeTime * sr)
    const l2 = Math.floor((activeTime - 2 * fadeTime) * sr)
    const len = l1 + l2
    const buf = this.ctx.createBuffer(1, len, sr)
    const p = buf.getChannelData(0)
    for (let i = 0; i < l1; i++) p[i] = shiftUp ? (l1 - i) / len : i / l1
    return buf
  }
}

// ───── эмбиент: дождь, океан, камин ─────
// Всё синтезируется на лету из шума — никаких аудиофайлов. Слои запускаются, только пока их громкость > 0.

export interface AmbientLevels {
  rain: number
  ocean: number
  fire: number
}


/** Розовый шум (фильтр Пола Келлета). */
function pinkNoise(len: number): Float32Array {
  const out = new Float32Array(len)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
  }
  return out
}

/** Коричневый шум (интеграл белого с утечкой): низкий гул. */
function brownNoise(len: number): Float32Array {
  const out = new Float32Array(len)
  let last = 0
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    out[i] = last * 3.5
  }
  return out
}

function stereo(ctx: BaseAudioContext, seconds: number, make: (len: number) => Float32Array): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) buf.copyToChannel(make(len) as Float32Array<ArrayBuffer>, ch)
  return buf
}

/** Случайные «капли»/«щелчки»: пуассоновский поток коротких затухающих всплесков шума. */
function pops(rate: number, minMs: number, maxMs: number, power: number, cluster = 0): (len: number, sr: number) => Float32Array {
  return (len, sr) => {
    const out = new Float32Array(len)
    const burst = (at: number, amp: number) => {
      const n = Math.floor(((minMs + Math.random() * (maxMs - minMs)) / 1000) * sr)
      for (let i = 0; i < n && at + i < len; i++) out[at + i] += (Math.random() * 2 - 1) * amp * Math.exp((-5 * i) / n)
    }
    const total = Math.floor((len / sr) * rate)
    for (let k = 0; k < total; k++) {
      const at = Math.floor(Math.random() * len)
      const amp = Math.pow(Math.random(), power)
      burst(at, amp)
      if (cluster && Math.random() < cluster) {
        const extra = 2 + Math.floor(Math.random() * 4)
        for (let e = 0; e < extra; e++) burst(at + Math.floor(Math.random() * 0.06 * sr), amp * (0.3 + Math.random() * 0.5))
      }
    }
    return out
  }
}

interface Layer {
  gain: GainNode
  stop: () => void
}

export class AmbientMixer {
  readonly output: GainNode
  private layers: Partial<Record<keyof AmbientLevels, Layer>> = {}
  private killTimers: Partial<Record<keyof AmbientLevels, ReturnType<typeof setTimeout>>> = {}
  private buffers: Record<string, AudioBuffer> = {}

  /** максимальная громкость слоя относительно полной шкалы — запас, чтобы вместе с музыкой не клиппировало */
  private static readonly MAX: AmbientLevels = { rain: 0.8, ocean: 0.7, fire: 0.55 }

  /** слои смешиваются сюда; затем лимитер — сумма слоёв и редкие громкие щелчки не должны клиппировать */
  private bus: GainNode

  constructor(private ctx: AudioContext) {
    this.output = ctx.createGain()
    this.bus = ctx.createGain()
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.knee.value = 6
    limiter.ratio.value = 14
    limiter.attack.value = 0.002
    limiter.release.value = 0.15
    this.bus.connect(limiter).connect(this.output)
  }

  private buf(name: string, make: () => AudioBuffer): AudioBuffer {
    return (this.buffers[name] ??= make())
  }

  set(levels: AmbientLevels): void {
    for (const k of ['rain', 'ocean', 'fire'] as const) {
      const v = Math.min(1, Math.max(0, levels[k] || 0))
      const t = this.ctx.currentTime
      if (v > 0.002) {
        clearTimeout(this.killTimers[k])
        this.killTimers[k] = undefined
        const layer = (this.layers[k] ??= this.build(k))
        layer.gain.gain.setTargetAtTime(v ** 1.6 * AmbientMixer.MAX[k], t, 0.15)
      } else if (this.layers[k] && !this.killTimers[k]) {
        const layer = this.layers[k]!
        layer.gain.gain.setTargetAtTime(0, t, 0.15)
        this.killTimers[k] = setTimeout(() => {
          layer.stop()
          this.layers[k] = undefined
          this.killTimers[k] = undefined
        }, 1200)
      }
    }
  }

  private build(kind: keyof AmbientLevels): Layer {
    const ctx = this.ctx
    const sr = ctx.sampleRate
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(this.bus)
    const nodes: AudioScheduledSourceNode[] = []
    const loop = (b: AudioBuffer) => {
      const s = ctx.createBufferSource()
      s.buffer = b
      s.loop = true
      // разные точки старта — слои не «склеиваются» в одинаковый узор
      s.start(0, Math.random() * (b.duration - 0.1))
      nodes.push(s)
      return s
    }
    const filter = (type: BiquadFilterType, f: number, q = 0.7) => {
      const n = ctx.createBiquadFilter()
      n.type = type
      n.frequency.value = f
      n.Q.value = q
      return n
    }
    const lfo = (hz: number) => {
      const o = ctx.createOscillator()
      o.frequency.value = hz
      o.start()
      nodes.push(o)
      return o
    }
    const g = (v: number) => {
      const n = ctx.createGain()
      n.gain.value = v
      return n
    }

    if (kind === 'rain') {
      // ровный шум дождя + отдельные капли
      const hiss = loop(this.buf('rain-hiss', () => stereo(ctx, 9, pinkNoise)))
      const hp = filter('highpass', 700)
      const lp = filter('lowpass', 9000)
      hiss.connect(hp).connect(lp).connect(g(0.8)).connect(out)
      const drops = loop(this.buf('rain-drops', () => stereo(ctx, 11, (len) => pops(70, 2, 9, 2.2)(len, sr))))
      drops.connect(filter('bandpass', 3200, 0.6)).connect(g(1.3)).connect(out)
      const rumble = loop(this.buf('brown', () => stereo(ctx, 10, brownNoise)))
      rumble.connect(filter('lowpass', 160)).connect(g(0.18)).connect(out)
    } else if (kind === 'ocean') {
      // накат волн: шум, чья громкость и «яркость» медленно качаются двумя несинхронными волнами
      const wash = loop(this.buf('ocean-brown', () => stereo(ctx, 13, brownNoise)))
      const lp = filter('lowpass', 900, 0.5)
      const amp = g(0.55)
      wash.connect(lp).connect(amp).connect(out)
      const foam = loop(this.buf('ocean-pink', () => stereo(ctx, 12, pinkNoise)))
      const foamAmp = g(0.0)
      foam.connect(filter('highpass', 1400)).connect(foamAmp).connect(out)
      const l1 = lfo(0.083)
      const l2 = lfo(0.051)
      l1.connect(g(0.3)).connect(amp.gain)
      l2.connect(g(0.2)).connect(amp.gain)
      l1.connect(g(700)).connect(lp.frequency)
      l2.connect(g(350)).connect(lp.frequency)
      foamAmp.gain.value = 0.05
      l1.connect(g(0.04)).connect(foamAmp.gain)
    } else {
      // камин: тёплый гул + треск
      const rumble = loop(this.buf('brown', () => stereo(ctx, 10, brownNoise)))
      const rl = filter('lowpass', 380)
      const ramp = g(0.35)
      rumble.connect(rl).connect(ramp).connect(out)
      lfo(0.7).connect(g(0.08)).connect(ramp.gain)
      const crack = loop(this.buf('fire-crackle', () => stereo(ctx, 13, (len) => pops(11, 1, 14, 3, 0.35)(len, sr))))
      crack.connect(filter('highpass', 500)).connect(g(1.2)).connect(out)
      const hiss = loop(this.buf('ocean-pink', () => stereo(ctx, 12, pinkNoise)))
      hiss.connect(filter('bandpass', 2500, 0.5)).connect(g(0.025)).connect(out)
    }

    return {
      gain: out,
      stop: () => {
        for (const n of nodes) {
          try {
            n.stop()
          } catch {
            /* уже остановлен */
          }
          n.disconnect()
        }
        out.disconnect()
      }
    }
  }
}

