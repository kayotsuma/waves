import { EQ_BANDS } from '@shared/defaults'
import type { AudioSettings, Track } from '@shared/types'
import { clamp, trackUrl } from './format'
import { AmbientMixer, PitchShifter, makeDistortionCurve, makeImpulse } from './effects'

/** За сколько секунд до конца трека подгружаем следующий на вторую деку. */
const PRELOAD_AHEAD = 8
/** Gapless: запускаем следующий трек за столько секунд до конца (компенсирует старт декодера). */
const GAPLESS_LEAD = 0.12

interface Deck {
  el: HTMLAudioElement
  /** нормализация громкости конкретного трека */
  norm: GainNode
  /** огибающая кроссфейда */
  fade: GainNode
  trackId: string | null
  /** HLS-плеер (hls.js) для веб-треков, которые отдаются потоком */
  hls: { destroy(): void } | null
  /** служебный номер загрузки: устаревшие асинхронные загрузки отбрасываются */
  token: number
  /** готовность источника (для веб-треков адрес звука получается асинхронно) */
  ready: Promise<void>
}

/**
 * Аудиодвижок. Граф:
 *   деки (<audio> → нормализация → кроссфейд) → запас под EQ → 10-полосный EQ → бас-буст
 *   → питч → дисторшн → реверб → громкость → выход (спектр снимается до регулятора громкости).
 * Две деки нужны для кроссфейда и gapless: следующий трек заранее грузится на свободную деку.
 * Источник декодируется как есть, без передискретизации и перекодирования на нашей стороне;
 * все эффекты по умолчанию выключены и в цепочке нейтральны.
 */
class AudioEngine {
  private decks: [Deck, Deck]
  private active = 0
  ctx: AudioContext | null = null
  analyser: AnalyserNode | null = null
  private pre: GainNode | null = null
  private vol: GainNode | null = null
  private eq: BiquadFilterNode[] = []
  private bass: BiquadFilterNode | null = null
  private pitch: PitchShifter | null = null
  private pitchDry: GainNode | null = null
  private pitchWet: GainNode | null = null
  private distDry: GainNode | null = null
  private distWet: GainNode | null = null
  private shaper: WaveShaperNode | null = null
  private revDry: GainNode | null = null
  private revWet: GainNode | null = null
  private convolver: ConvolverNode | null = null
  private revDecay = 0
  private ambient: AmbientMixer | null = null
  private enh: { warm: BiquadFilterNode; mud: BiquadFilterNode; clar: BiquadFilterNode; pres: BiquadFilterNode; air: BiquadFilterNode; excite: GainNode; comp: DynamicsCompressorNode; makeup: GainNode } | null = null
  private sleepGain: GainNode | null = null
  /** таймер сна «до конца трека»: не переходить к следующему (ни gapless, ни кроссфейдом) */
  holdAtEnd = false
  private settings: AudioSettings | null = null
  private sink = 'default'

  /** Что играть следом (задаёт плеер). null — следующего нет, переход не нужен. */
  nextProvider: () => Track | null = () => null
  /** Движок сам перешёл на следующий трек (кроссфейд/gapless) — плееру нужно обновить очередь. */
  onAdvance: (track: Track) => void = () => {}
  onEnded: () => void = () => {}
  onError: (message: string) => void = () => {}
  onPlayState: (playing: boolean) => void = () => {}
  onDuration: (seconds: number) => void = () => {}
  onProgress: (seconds: number) => void = () => {}

  private preloaded: Track | null = null
  private fadingOut: Deck | null = null
  private fadeTimer: ReturnType<typeof setTimeout> | null = null
  private watcher: ReturnType<typeof setInterval> | null = null
  private current: Track | null = null

  constructor() {
    this.decks = [this.makeDeck(), this.makeDeck()]
  }

  private makeDeck(): Deck {
    const el = new Audio()
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.preservesPitch = true
    const mine = () => this.decks[this.active]?.el === el
    el.addEventListener('ended', () => mine() && this.onEnded())
    el.addEventListener('play', () => mine() && this.onPlayState(true))
    el.addEventListener('pause', () => mine() && !this.transitioning && this.onPlayState(false))
    el.addEventListener('durationchange', () => mine() && Number.isFinite(el.duration) && this.onDuration(el.duration))
    el.addEventListener('timeupdate', () => mine() && this.onProgress(el.currentTime))
    el.addEventListener('error', () => {
      if (!mine()) return
      const code = el.error?.code
      this.onError(code === 4 ? 'Файл не найден или формат не поддерживается' : 'Ошибка воспроизведения')
    })
    // norm/fade создаются вместе с графом (ensureGraph)
    return { el, norm: null as unknown as GainNode, fade: null as unknown as GainNode, trackId: null, hls: null, token: 0, ready: Promise.resolve() }
  }

  /** Текущая (активная) дека. */
  get el(): HTMLAudioElement {
    return this.decks[this.active].el
  }
  private get deck(): Deck {
    return this.decks[this.active]
  }
  private get idle(): Deck {
    return this.decks[1 - this.active]
  }
  private get transitioning(): boolean {
    return this.fadingOut !== null
  }

  private ensureGraph(): void {
    if (this.ctx) return
    const ctx = new AudioContext({ latencyHint: 'playback' })
    const pre = ctx.createGain()
    const vol = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.82

    for (const d of this.decks) {
      const src = ctx.createMediaElementSource(d.el)
      d.norm = ctx.createGain()
      d.fade = ctx.createGain()
      src.connect(d.norm)
      d.norm.connect(d.fade)
      d.fade.connect(pre)
    }
    this.decks[1 - this.active].fade.gain.value = 0

    let node: AudioNode = pre
    this.eq = EQ_BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter()
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
      f.frequency.value = freq
      f.Q.value = 1.0
      f.gain.value = 0
      node.connect(f)
      node = f
      return f
    })

    // бас-буст
    const bass = ctx.createBiquadFilter()
    bass.type = 'lowshelf'
    bass.frequency.value = 110
    bass.gain.value = 0
    node.connect(bass)
    node = bass

    // улучшение звука: тепло, ясность вокала, «воздух» и мягкое уплотнение (все нейтральны, пока выключены)
    const bq = (type: BiquadFilterType, freq: number, q = 1) => {
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      f.gain.value = 0
      return f
    }
    const warm = bq('lowshelf', 120)
    const mud = bq('peaking', 320, 1)
    const pres = bq('peaking', 1500, 0.8)
    const clar = bq('peaking', 3200, 0.9)
    const air = bq('highshelf', 10500)
    node.connect(warm)
    warm.connect(mud)
    mud.connect(pres)
    pres.connect(clar)
    clar.connect(air)
    // лёгкие гармоники высоких частот — «блеск» без резкости
    const exciteHp = bq('highpass', 5500, 0.7)
    const exciteShape = ctx.createWaveShaper()
    exciteShape.curve = makeDistortionCurve(0.5)
    exciteShape.oversample = '2x'
    const excite = ctx.createGain()
    excite.gain.value = 0
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -22
    comp.knee.value = 24
    comp.ratio.value = 1
    comp.attack.value = 0.025
    comp.release.value = 0.25
    const makeup = ctx.createGain()
    const enhOut = ctx.createGain()
    air.connect(comp)
    air.connect(exciteHp)
    exciteHp.connect(exciteShape)
    exciteShape.connect(excite)
    excite.connect(enhOut)
    comp.connect(makeup)
    makeup.connect(enhOut)
    node = enhOut
    this.enh = { warm, mud, clar, pres, air, excite, comp, makeup }

    // питч (сдвиг тона независимо от темпа)
    const pitch = new PitchShifter(ctx)
    const pitchDry = ctx.createGain()
    const pitchWet = ctx.createGain()
    const pitchOut = ctx.createGain()
    pitchWet.gain.value = 0
    node.connect(pitchDry)
    node.connect(pitch.input)
    pitch.output.connect(pitchWet)
    pitchDry.connect(pitchOut)
    pitchWet.connect(pitchOut)
    node = pitchOut

    // дисторшн
    const shaper = ctx.createWaveShaper()
    shaper.oversample = '4x'
    const distDry = ctx.createGain()
    const distWet = ctx.createGain()
    const distOut = ctx.createGain()
    distWet.gain.value = 0
    node.connect(distDry)
    node.connect(shaper)
    shaper.connect(distWet)
    distDry.connect(distOut)
    distWet.connect(distOut)
    node = distOut

    // реверб
    const convolver = ctx.createConvolver()
    const revDry = ctx.createGain()
    const revWet = ctx.createGain()
    const revOut = ctx.createGain()
    revWet.gain.value = 0
    node.connect(revDry)
    node.connect(convolver)
    convolver.connect(revWet)
    revDry.connect(revOut)
    revWet.connect(revOut)
    node = revOut

    node.connect(vol)
    node.connect(analyser) // спектр снимаем до регулятора громкости — не зависит от ползунка
    const sleepGain = ctx.createGain() // отдельный регулятор для плавного затухания таймера сна
    vol.connect(sleepGain)
    sleepGain.connect(ctx.destination)
    this.sleepGain = sleepGain
    // эмбиент идёт мимо EQ и эффектов — сразу на регулятор громкости
    this.ambient = new AmbientMixer(ctx)
    this.ambient.output.connect(vol)

    this.ctx = ctx
    this.pre = pre
    this.vol = vol
    this.analyser = analyser
    this.bass = bass
    this.pitch = pitch
    this.pitchDry = pitchDry
    this.pitchWet = pitchWet
    this.shaper = shaper
    this.distDry = distDry
    this.distWet = distWet
    this.convolver = convolver
    this.revDry = revDry
    this.revWet = revWet
    if (this.settings) this.apply(this.settings)
  }

  /** Громкость трека для нормализации, дБ. */
  private normDb(s: AudioSettings, tr: Track | null): number {
    if (!s.normalize || tr?.loudness == null) return 0
    let db = clamp(s.targetLufs - tr.loudness, -14, 8)
    if (tr.peak != null) db = Math.min(db, -1 - tr.peak) // не выходим за 0 dBFS
    return db
  }

  /** Применяет настройки звука (громкость, EQ, эффекты, нормализация, устройство вывода). */
  apply(s: AudioSettings): void {
    this.settings = s
    for (const d of this.decks) {
      d.el.preservesPitch = true
      d.el.playbackRate = clamp(s.tempo || 1, 0.5, 2)
    }
    // эмбиент может играть и без музыки: при необходимости поднимаем граф сами
    const amb = s.ambient
    if (!this.ctx && amb && (amb.rain > 0 || amb.ocean > 0 || amb.fire > 0)) this.ensureGraph()
    if (!this.ctx || !this.pre || !this.vol) return
    if (this.ctx.state === 'suspended' && amb && (amb.rain > 0 || amb.ocean > 0 || amb.fire > 0)) void this.ctx.resume().catch(() => {})
    if (amb) this.ambient?.set(amb)
    const t = this.ctx.currentTime
    const set = (p: AudioParam, v: number, tc = 0.03) => p.setTargetAtTime(v, t, tc)

    set(this.vol.gain, s.muted ? 0 : s.volume ** 2, 0.02)
    this.eq.forEach((f, i) => set(f.gain, s.eqEnabled ? s.eqGains[i] ?? 0 : 0))

    // нормализация — на деке своего трека
    const norm = (d: Deck) => {
      const tr = d.trackId && this.current?.id === d.trackId ? this.current : this.preloaded?.id === d.trackId ? this.preloaded : null
      set(d.norm.gain, 10 ** (this.normDb(s, tr) / 20), 0.05)
    }
    this.decks.forEach(norm)

    // улучшение звука
    const en = s.enhance
    if (this.enh && en) {
      const on = en.enabled
      const k = (v: number) => (on ? v : 0)
      set(this.enh.warm.gain, k(en.warmth * 4))
      set(this.enh.mud.gain, k(-en.clarity * 2.5))
      set(this.enh.pres.gain, k(en.clarity * 2))
      set(this.enh.clar.gain, k(en.clarity * 5))
      set(this.enh.air.gain, k(en.air * 6))
      set(this.enh.excite.gain, k(en.air * 0.14))
      const ratio = 1 + k(en.density) * 2.5
      set(this.enh.comp.ratio, ratio, 0.05)
      set(this.enh.makeup.gain, 10 ** ((k(en.density) * 3) / 20), 0.05) // компенсируем просадку громкости от компрессора
    }

    // бас, питч, дисторшн, реверб
    set(this.bass!.gain, s.bassBoost)
    const pitchOn = Math.abs(s.pitch) > 0.01
    this.pitch!.setSemitones(s.pitch)
    set(this.pitchDry!.gain, pitchOn ? 0 : 1)
    set(this.pitchWet!.gain, pitchOn ? 1 : 0)

    if (s.distortion > 0.001) this.shaper!.curve = makeDistortionCurve(s.distortion)
    set(this.distWet!.gain, s.distortion > 0.001 ? Math.min(1, s.distortion * 1.4) : 0)
    set(this.distDry!.gain, s.distortion > 0.001 ? 1 - Math.min(1, s.distortion * 1.4) * 0.6 : 1)

    if (s.reverb > 0.001 && Math.abs(s.reverbDecay - this.revDecay) > 0.01) {
      this.revDecay = s.reverbDecay
      this.convolver!.buffer = makeImpulse(this.ctx, s.reverbDecay)
    }
    set(this.revWet!.gain, s.reverb > 0.001 ? s.reverb * 0.9 : 0)
    set(this.revDry!.gain, 1 - s.reverb * 0.35)

    // запас под усиление (EQ, бас, дисторшн, реверб), чтобы не клиппировать
    let head = 0
    if (s.eqEnabled) head += Math.max(0, ...s.eqGains)
    head += Math.max(0, s.bassBoost) * 0.8
    if (s.enhance?.enabled) head += (s.enhance.clarity * 5 + s.enhance.air * 6 + s.enhance.warmth * 4) * 0.55 + s.enhance.density * 3
    head += s.distortion * 3 + s.reverb * 2
    set(this.pre.gain, 10 ** (-head / 20), 0.05)

    if (s.outputDeviceId !== this.sink) {
      this.sink = s.outputDeviceId
      const c = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
      c.setSinkId?.(s.outputDeviceId === 'default' ? '' : s.outputDeviceId).catch(() => {})
    }
  }

  // ───── загрузка и управление ─────

  /** Жёстко останавливает кроссфейд и сбрасывает подгруженный трек. */
  private cancelTransition(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer)
    this.fadeTimer = null
    const out = this.fadingOut
    this.fadingOut = null
    if (out) this.silence(out)
    this.releaseIdle()
    if (this.ctx) {
      const t = this.ctx.currentTime
      this.deck.fade.gain.cancelScheduledValues(t)
      this.deck.fade.gain.setValueAtTime(1, t)
    }
  }

  /** Освобождает источник деки (и HLS-плеер, если он был). */
  private detach(d: Deck): void {
    d.token++
    d.ready = Promise.resolve()
    d.hls?.destroy()
    d.hls = null
    d.el.removeAttribute('src')
    d.el.load()
  }

  /** Подключает трек к деке: локальный файл — сразу, веб-трек — после получения адреса потока. */
  private attach(d: Deck, track: Track): void {
    d.hls?.destroy()
    d.hls = null
    const tok = ++d.token
    if (!track.remote) {
      d.ready = Promise.resolve()
      d.el.src = trackUrl(track)
      return
    }
    d.ready = (async () => {
      try {
        const info = await window.wave.stream.info(track.id)
        if (d.token !== tok) return
        if (info.kind === 'file') {
          d.el.src = info.url
          return
        }
        const { default: Hls } = await import('hls.js')
        if (d.token !== tok) return
        if (!Hls.isSupported()) throw new Error('Потоковое воспроизведение не поддерживается в этой сборке')
        const hls = new Hls({ enableWorker: false, maxBufferLength: 40 })
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal && d.token === tok && this.decks[this.active] === d) this.onError('Не удалось воспроизвести поток. Проверьте интернет или скачайте трек.')
        })
        hls.loadSource(info.url)
        hls.attachMedia(d.el)
        d.hls = hls
      } catch (e) {
        if (d.token === tok) this.onError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Ошибка потока')
      }
    })()
  }

  private silence(d: Deck): void {
    d.el.pause()
    if (this.ctx && d.fade) {
      d.fade.gain.cancelScheduledValues(this.ctx.currentTime)
      d.fade.gain.setValueAtTime(0, this.ctx.currentTime)
    }
  }

  private releaseIdle(): void {
    const d = this.idle
    if (this.preloaded || d.trackId) {
      d.el.pause()
      this.detach(d)
    }
    d.trackId = null
    this.preloaded = null
  }

  load(track: Track, startAt = 0): void {
    this.cancelTransition()
    this.current = track
    const d = this.deck
    d.trackId = track.id
    this.attach(d, track)
    if (startAt > 0) {
      const seek = () => {
        d.el.currentTime = startAt
        d.el.removeEventListener('loadedmetadata', seek)
      }
      d.el.addEventListener('loadedmetadata', seek)
    }
    if (this.settings) this.apply(this.settings)
    this.startWatcher()
  }

  async play(): Promise<void> {
    this.ensureGraph()
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
    try {
      await this.deck.ready
      await this.el.play()
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') throw e
    }
  }

  /** Очередь изменилась: заранее подгруженный «следующий» мог устареть. */
  invalidatePreload(): void {
    if (!this.transitioning) this.releaseIdle()
  }

  pause(): void {
    // при паузе во время кроссфейда просто завершаем его: старый трек умолкает
    if (this.transitioning) this.finishTransition()
    this.el.pause()
  }

  /** Плавно гасит звук (музыку и эмбиент) за `seconds` и ставит на паузу; затем возвращает громкость. */
  fadeOutAndPause(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const g = this.sleepGain?.gain
      const ctx = this.ctx
      if (!g || !ctx) {
        this.pause()
        return resolve()
      }
      const t = ctx.currentTime
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      g.linearRampToValueAtTime(0, t + seconds)
      setTimeout(() => {
        this.pause()
        g.cancelScheduledValues(ctx.currentTime)
        g.setValueAtTime(1, ctx.currentTime)
        resolve()
      }, seconds * 1000 + 100)
    })
  }

  seek(t: number): void {
    if (Number.isFinite(t)) this.el.currentTime = clamp(t, 0, this.el.duration || t)
  }

  get time(): number {
    return this.el.currentTime
  }

  stop(): void {
    this.cancelTransition()
    for (const d of this.decks) {
      d.el.pause()
      this.detach(d)
      d.trackId = null
    }
    this.current = null
    this.stopWatcher()
  }

  // ───── кроссфейд / gapless ─────

  private startWatcher(): void {
    if (this.watcher) return
    this.watcher = setInterval(() => this.tick(), 100)
  }

  private stopWatcher(): void {
    if (this.watcher) clearInterval(this.watcher)
    this.watcher = null
  }

  private tick(): void {
    const s = this.settings
    const el = this.el
    if (!s || !this.ctx || !this.current || el.paused || this.transitioning || this.holdAtEnd) return
    const dur = el.duration
    if (!Number.isFinite(dur) || dur <= 0) return
    // темп меняет реальную длительность: считаем оставшееся в реальных секундах
    const rate = el.playbackRate || 1
    const remaining = (dur - el.currentTime) / rate
    const fade = s.crossfade > 0 ? Math.min(s.crossfade, dur / rate / 2) : 0
    if (fade === 0 && !s.gapless) return

    if (!this.preloaded && remaining <= fade + PRELOAD_AHEAD) {
      const next = this.nextProvider()
      // веб-треки не подгружаем заранее: адрес потока получается асинхронно, переход пройдёт обычным путём
      if (!next || next.missing || next.remote) return
      this.preloaded = next
      const d = this.idle
      d.trackId = next.id
      d.el.src = trackUrl(next)
      d.el.load()
      this.apply(s)
    }
    if (this.preloaded && remaining <= (fade || GAPLESS_LEAD)) this.startTransition(fade)
  }

  private startTransition(fade: number): void {
    const next = this.preloaded
    const ctx = this.ctx
    if (!next || !ctx) return
    const out = this.deck
    const inc = this.idle
    this.preloaded = null

    // дека с новым треком становится «текущей» сразу — время, длительность и события идут от неё
    this.active = 1 - this.active
    this.current = next
    this.fadingOut = out
    const t = ctx.currentTime
    inc.el.currentTime = 0
    inc.fade.gain.cancelScheduledValues(t)
    out.fade.gain.cancelScheduledValues(t)
    if (fade > 0) {
      const n = 64
      const up = new Float32Array(n)
      const down = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1)
        up[i] = Math.sin((x * Math.PI) / 2) // равная мощность
        down[i] = Math.cos((x * Math.PI) / 2)
      }
      inc.fade.gain.setValueCurveAtTime(up, t, fade)
      out.fade.gain.setValueCurveAtTime(down, t, fade)
    } else {
      inc.fade.gain.setValueAtTime(1, t)
      out.fade.gain.setValueAtTime(0, t)
    }
    void inc.el.play().catch(() => {})
    this.onAdvance(next)
    this.onDuration(Number.isFinite(inc.el.duration) ? inc.el.duration : next.duration)
    this.fadeTimer = setTimeout(() => this.finishTransition(), fade * 1000 + 120)
  }

  private finishTransition(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer)
    this.fadeTimer = null
    const out = this.fadingOut
    this.fadingOut = null
    if (out) {
      this.silence(out)
      this.detach(out)
      out.trackId = null
    }
    if (this.ctx) {
      const t = this.ctx.currentTime
      this.deck.fade.gain.cancelScheduledValues(t)
      this.deck.fade.gain.setValueAtTime(1, t)
    }
  }
}

export const engine = new AudioEngine()
