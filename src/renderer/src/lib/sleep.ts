import { create } from 'zustand'
import { engine } from './audio'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

const FADE_SECONDS = 10

interface SleepState {
  /** когда выключить (мс), либо null */
  endsAt: number | null
  /** выключить, когда доиграет текущий трек */
  afterTrack: boolean
  inMinutes: (m: number) => void
  afterCurrentTrack: () => void
  cancel: () => void
  /** вызывается, когда время вышло / трек закончился */
  fire: (fade: boolean) => void
}

export const useSleep = create<SleepState>((set, get) => ({
  endsAt: null,
  afterTrack: false,
  inMinutes: (m) => {
    engine.holdAtEnd = false
    set({ endsAt: Date.now() + m * 60_000, afterTrack: false })
  },
  afterCurrentTrack: () => {
    engine.holdAtEnd = true
    set({ endsAt: null, afterTrack: true })
  },
  cancel: () => {
    engine.holdAtEnd = false
    set({ endsAt: null, afterTrack: false })
  },
  fire: (fade) => {
    engine.holdAtEnd = false
    set({ endsAt: null, afterTrack: false })
    const stopAmbient = () => {
      const a = useSettings.getState().settings.audio.ambient
      if (a.rain > 0 || a.ocean > 0 || a.fire > 0) useSettings.getState().patch({ audio: { ambient: { rain: 0, ocean: 0, fire: 0 } } })
    }
    if (fade) void engine.fadeOutAndPause(FADE_SECONDS).then(stopAmbient)
    else {
      engine.pause()
      stopAmbient()
    }
    useUI.getState().toast('Таймер сна: воспроизведение остановлено', 'info')
  }
}))

setInterval(() => {
  const { endsAt, fire } = useSleep.getState()
  // затухание занимает FADE_SECONDS и заканчивается ровно в момент endsAt
  if (endsAt !== null && Date.now() >= endsAt - FADE_SECONDS * 1000) fire(true)
}, 1000)
