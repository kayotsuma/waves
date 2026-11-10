import type { Track } from '@shared/types'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

interface PlayerSnapshot {
  currentId: string | null
  playing: boolean
  duration: number
  shuffle: boolean
  repeat: string
  queue: string[]
}

const snapshot = (): PlayerSnapshot => {
  const s = usePlayer.getState()
  return { currentId: s.currentId, playing: s.playing, duration: s.duration, shuffle: s.shuffle, repeat: s.repeat, queue: [...s.queue] }
}

/** API, доступный плагинам как `window.WaveAPI`. Намеренно небольшой и стабильный. */
const api = {
  version: 1,
  player: {
    getState: snapshot,
    subscribe: (cb: (s: PlayerSnapshot) => void) => usePlayer.subscribe(() => cb(snapshot())),
    toggle: () => usePlayer.getState().toggle(),
    next: () => usePlayer.getState().next(),
    prev: () => usePlayer.getState().prev(),
    seek: (t: number) => usePlayer.getState().seek(Number(t) || 0),
    play: (ids: string[]) => usePlayer.getState().playTracks(ids.map(String))
  },
  library: {
    getTracks: (): Track[] => useLibrary.getState().tracks,
    getTrack: (id: string): Track | undefined => useLibrary.getState().byId[id]
  },
  ui: {
    toast: (text: string, kind: 'info' | 'error' | 'success' = 'info') => useUI.getState().toast(String(text), kind)
  },
  settings: {
    get: () => useSettings.getState().settings,
    patch: (p: Parameters<ReturnType<typeof useSettings.getState>['patch']>[0]) => useSettings.getState().patch(p)
  },
  /** Добавляет CSS; возвращает функцию удаления. */
  css: (text: string): (() => void) => {
    const el = document.createElement('style')
    el.dataset.wavePlugin = 'inline'
    el.textContent = String(text)
    document.head.appendChild(el)
    return () => el.remove()
  }
}

declare global {
  interface Window {
    WaveAPI: typeof api
  }
}

const loaded = new Map<string, HTMLElement[]>()

/** Подключает плагин: style.css и index.js из wave://plugin/<id>/. */
function load(id: string, hasJs: boolean, hasCss: boolean): void {
  if (loaded.has(id)) return
  const els: HTMLElement[] = []
  if (hasCss) {
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = `wave://plugin/${id}/style.css`
    document.head.appendChild(l)
    els.push(l)
  }
  if (hasJs) {
    const s = document.createElement('script')
    s.src = `wave://plugin/${id}/index.js`
    s.onerror = () => useUI.getState().toast(`Плагин «${id}» не загрузился`, 'error')
    document.head.appendChild(s)
    els.push(s)
  }
  loaded.set(id, els)
}

/** Синхронизирует загруженные плагины с настройками. Возвращает true, если нужно перезагрузить окно (отключён JS-плагин). */
export async function syncPlugins(enabled: string[]): Promise<boolean> {
  window.WaveAPI = api
  const list = await window.wave.plugins.list()
  let needReload = false
  for (const p of list) {
    if (enabled.includes(p.id)) load(p.id, p.hasJs, p.hasCss)
    else if (loaded.has(p.id)) {
      const els = loaded.get(p.id)!
      for (const e of els) {
        if (e.tagName === 'LINK') e.remove()
        else needReload = true // код уже выполнен — отменить его можно только перезагрузкой
      }
      if (!els.some((e) => e.tagName === 'SCRIPT')) loaded.delete(p.id)
    }
  }
  return needReload
}
