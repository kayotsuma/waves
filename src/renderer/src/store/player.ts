import { create } from 'zustand'
import { engine } from '@/lib/audio'
import { useSleep } from '@/lib/sleep'
import { useLibrary } from './library'
import { useSettings } from './settings'
import { useUI } from './ui'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  queue: string[]
  /** порядок до перемешивания */
  original: string[]
  index: number
  currentId: string | null
  playing: boolean
  duration: number
  shuffle: boolean
  repeat: RepeatMode
  playTracks: (ids: string[], start?: number, opts?: { shuffle?: boolean }) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (t: number) => void
  jumpTo: (i: number) => void
  playNext: (ids: string[]) => void
  enqueue: (ids: string[]) => void
  removeAt: (i: number) => void
  clearUpcoming: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  restore: () => void
}

const STORAGE_KEY = 'wave.player.v1'

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

let counted = false
let errorSkips = 0

// ───── история прослушиваний ─────
// Считаем, сколько трек реально звучал (перемотка не в счёт), и раз в 15 секунд отправляем «пульс» в main.
interface Listen {
  session: string
  id: string
  at: number
  secs: number
  lastT: number
  sent: number
}
let listen: Listen | null = null
const flushListen = () => {
  if (!listen || listen.secs < 5 || listen.secs - listen.sent < 1) return
  listen.sent = listen.secs
  void window.wave.listens.tick(listen.session, listen.id, listen.at, listen.secs).catch(() => {})
}
function trackListen(id: string, t: number): void {
  // другой трек или тот же с начала (повтор) — новое прослушивание
  if (!listen || listen.id !== id || (t < 2 && listen.lastT > 10)) {
    flushListen()
    listen = { session: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, id, at: Date.now(), secs: 0, lastT: t, sent: 0 }
    return
  }
  const d = t - listen.lastT
  listen.lastT = t
  if (d > 0 && d < 2.5) listen.secs += d
  if (listen.secs - listen.sent >= 15) flushListen()
}
window.addEventListener('beforeunload', flushListen)

export const usePlayer = create<PlayerState>((set, get) => {
  const trackOf = (id: string | null) => (id ? useLibrary.getState().byId[id] : undefined)

  const persist = () => {
    const s = get()
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ queue: s.queue, original: s.original, index: s.index, shuffle: s.shuffle, repeat: s.repeat, pos: engine.time })
      )
    } catch {
      /* localStorage может быть недоступен */
    }
  }

  /** Индекс трека, который сыграет после текущего (null — очередь кончилась). */
  const upcomingIndex = (): number | null => {
    const { index, queue, repeat } = get()
    if (!queue.length || repeat === 'one') return null
    if (index + 1 < queue.length) return index + 1
    return repeat === 'all' ? 0 : null
  }

  const loadCurrent = (autoplay: boolean, startAt = 0) => {
    const { currentId } = get()
    const t = trackOf(currentId)
    counted = false
    if (!t) return
    if (t.missing) {
      useUI.getState().toast(`Файл не найден: ${t.artist} — ${t.title}`, 'error')
      if (autoplay) get().next()
      return
    }
    engine.load(t, startAt)
    if (autoplay) void engine.play().catch(() => {})
    set({ duration: t.duration })
    persist()
  }

  const setIndex = (i: number, autoplay = true) => {
    const { queue } = get()
    if (i < 0 || i >= queue.length) return
    set({ index: i, currentId: queue[i] })
    loadCurrent(autoplay)
  }

  engine.nextProvider = () => {
    const i = upcomingIndex()
    return i === null ? null : trackOf(get().queue[i]) ?? null
  }
  // кроссфейд/gapless: движок уже играет следующий трек — синхронизируем очередь без перезагрузки
  engine.onAdvance = (track) => {
    const i = upcomingIndex()
    if (i === null || get().queue[i] !== track.id) return
    counted = false
    set({ index: i, currentId: track.id, duration: track.duration })
    persist()
  }

  engine.onPlayState = (playing) => set({ playing })
  engine.onDuration = (duration) => {
    set({ duration })
    // у веб-треков длительность неизвестна заранее — запоминаем, когда плеер её узнал
    const id = get().currentId
    const t = id ? useLibrary.getState().byId[id] : undefined
    if (t?.remote && duration > 0 && Math.abs(duration - t.duration) > 1) void window.wave.library.setDuration(t.id, duration)
  }
  engine.onProgress = (t) => {
    const { currentId, duration } = get()
    if (currentId && get().playing) trackListen(currentId, t)
    if (!counted && currentId && t > Math.min(30, (duration || 60) / 2)) {
      counted = true
      void window.wave.library.played(currentId)
    }
    if (t > 1) errorSkips = 0
  }
  engine.onEnded = () => {
    // таймер сна «до конца трека»
    if (useSleep.getState().afterTrack) return useSleep.getState().fire(false)
    const { repeat } = get()
    if (repeat === 'one') {
      engine.seek(0)
      void engine.play()
      counted = false
      return
    }
    get().next()
  }
  engine.onError = (message) => {
    const t = trackOf(get().currentId)
    useUI.getState().toast(`${t ? `${t.title}: ` : ''}${message}`, 'error')
    // не зацикливаемся, если подряд не играют несколько треков
    if (++errorSkips <= 3 && get().index < get().queue.length - 1) setTimeout(() => get().next(), 600)
  }
  setInterval(() => get().currentId && get().playing && persist(), 5000)

  return {
    queue: [],
    original: [],
    index: -1,
    currentId: null,
    playing: false,
    duration: 0,
    shuffle: false,
    repeat: 'off',

    playTracks: (ids, start = 0, opts) => {
      if (!ids.length) return
      const explicit = opts?.shuffle === true
      const shuffle = opts?.shuffle ?? get().shuffle
      const startId = ids[Math.min(start, ids.length - 1)]
      let queue = ids
      let index = Math.min(start, ids.length - 1)
      if (shuffle) {
        queue = explicit ? shuffled(ids) : [startId, ...shuffled(ids.filter((_, i) => i !== start))]
        index = 0
      }
      set({ original: ids, queue, shuffle, index })
      setIndex(get().index)
    },

    toggle: () => {
      const { currentId, playing, queue } = get()
      if (!currentId) {
        if (queue.length) setIndex(0)
        return
      }
      if (playing) engine.pause()
      else if (!engine.el.src) loadCurrent(true, 0)
      else void engine.play().catch(() => {})
    },

    next: () => {
      const { index, queue, repeat } = get()
      if (!queue.length) return
      if (index + 1 < queue.length) setIndex(index + 1)
      else if (repeat === 'all') setIndex(0)
      else {
        engine.pause()
        engine.seek(0)
      }
    },

    prev: () => {
      const { index, queue, repeat } = get()
      if (engine.time > 3 || !queue.length) return engine.seek(0)
      if (index > 0) setIndex(index - 1)
      else if (repeat === 'all') setIndex(queue.length - 1)
      else engine.seek(0)
    },

    seek: (t) => engine.seek(t),
    jumpTo: (i) => setIndex(i),

    playNext: (ids) => {
      engine.invalidatePreload()
      const { queue, original, index, currentId } = get()
      if (!currentId) return get().playTracks(ids)
      const q = [...queue]
      q.splice(index + 1, 0, ...ids)
      const o = [...original]
      const oi = o.indexOf(currentId)
      o.splice(oi + 1, 0, ...ids)
      set({ queue: q, original: o })
      persist()
    },

    enqueue: (ids) => {
      engine.invalidatePreload()
      const { queue, original, currentId } = get()
      if (!currentId) return get().playTracks(ids)
      set({ queue: [...queue, ...ids], original: [...original, ...ids] })
      persist()
    },

    removeAt: (i) => {
      engine.invalidatePreload()
      const { queue, index, original } = get()
      if (i === index) return
      const id = queue[i]
      const q = queue.filter((_, k) => k !== i)
      const oi = original.indexOf(id)
      const o = original.filter((_, k) => k !== oi)
      set({ queue: q, original: o, index: i < index ? index - 1 : index })
      persist()
    },

    clearUpcoming: () => {
      engine.invalidatePreload()
      const { queue, index, original, currentId } = get()
      if (index < 0) return
      const keep = queue.slice(0, index + 1)
      set({ queue: keep, original: original.filter((id) => keep.includes(id) || id === currentId) })
      persist()
    },

    toggleShuffle: () => {
      engine.invalidatePreload()
      const { shuffle, queue, original, currentId, index } = get()
      if (!shuffle) {
        const rest = queue.filter((_, i) => i !== index)
        set({ shuffle: true, original: queue, queue: currentId ? [currentId, ...shuffled(rest)] : shuffled(queue), index: currentId ? 0 : -1 })
      } else {
        const idx = currentId ? original.indexOf(currentId) : -1
        set({ shuffle: false, queue: original, index: idx })
      }
      persist()
    },

    cycleRepeat: () => {
      engine.invalidatePreload()
      const order: RepeatMode[] = ['off', 'all', 'one']
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] })
      persist()
    },

    restore: () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const s = JSON.parse(raw)
        const byId = useLibrary.getState().byId
        const queue: string[] = (s.queue ?? []).filter((id: string) => byId[id])
        if (!queue.length) return
        const currentOld = s.queue?.[s.index]
        const index = Math.max(0, queue.indexOf(currentOld))
        set({
          queue,
          original: (s.original ?? queue).filter((id: string) => byId[id]),
          index,
          currentId: queue[index],
          shuffle: !!s.shuffle,
          repeat: s.repeat ?? 'off'
        })
        loadCurrent(false, Number(s.pos) || 0)
      } catch {
        /* ignore */
      }
    }
  }
})

// Применяем настройки звука при любом их изменении.
useSettings.subscribe((s, prev) => {
  if (s.settings.audio !== prev.settings.audio || s.loaded !== prev.loaded) engine.apply(s.settings.audio)
})
// Нормализация зависит от текущего трека.
usePlayer.subscribe((s, prev) => {
  if (s.currentId !== prev.currentId) engine.apply(useSettings.getState().settings.audio)
})
