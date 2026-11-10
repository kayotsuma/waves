import { engine } from './audio'
import { trackById } from './actions'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'

/** Передаёт состояние плеера в главный процесс для Discord Rich Presence (если включено в настройках). */
export function startPresence(): () => void {
  let sent: { id: string | null; playing: boolean; at: number; pos: number } = { id: null, playing: false, at: 0, pos: 0 }

  const push = () => {
    const d = useSettings.getState().settings.integrations?.discord
    if (!d?.enabled) return
    const { currentId, playing, duration } = usePlayer.getState()
    const t = trackById(currentId)
    if (!t || !playing) {
      sent = { id: currentId, playing: false, at: Date.now(), pos: 0 }
      void window.wave.presence.update(null)
      return
    }
    const pos = engine.time
    sent = { id: t.id, playing: true, at: Date.now(), pos }
    const url = t.source.url && /^https:\/\//.test(t.source.url) ? t.source.url : undefined
    void window.wave.presence.update({ title: t.title, artist: t.artist, duration: duration || t.duration, position: pos, playing: true, url })
  }

  const unsubPlayer = usePlayer.subscribe((s, prev) => {
    if (s.currentId !== prev.currentId || s.playing !== prev.playing) push()
  })
  const unsubSettings = useSettings.subscribe((s, prev) => {
    if (s.settings.integrations?.discord !== prev.settings.integrations?.discord) push()
  })
  // перемотка: раз в 4 с сверяем, не ушла ли позиция от ожидаемой
  const timer = setInterval(() => {
    if (!sent.playing) return
    const expected = sent.pos + ((Date.now() - sent.at) / 1000) * (engine.el.playbackRate || 1)
    if (Math.abs(engine.time - expected) > 3) push()
  }, 4000)
  push()
  return () => {
    unsubPlayer()
    unsubSettings()
    clearInterval(timer)
  }
}
