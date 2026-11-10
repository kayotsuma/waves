import { create } from 'zustand'
import type { AlignStatus, LyricsData } from '@shared/types'

type Status = 'idle' | 'loading' | 'done' | 'none' | 'error'

interface LyricsState {
  /** синхронизация по звуку: модель, очередь, текущий трек */
  align: AlignStatus | null
  byId: Record<string, LyricsData | null>
  status: Record<string, Status>
  load: (id: string, opts?: { force?: boolean; genius?: boolean }) => Promise<void>
  set: (id: string, data: LyricsData | null) => void
}

export const useLyrics = create<LyricsState>((set, get) => ({
  align: null,
  byId: {},
  status: {},
  set: (id, data) => set({ byId: { ...get().byId, [id]: data }, status: { ...get().status, [id]: data ? 'done' : 'none' } }),
  load: async (id, opts = {}) => {
    const st = get().status[id]
    if (st === 'loading') return
    if (!opts.force && !opts.genius && (st === 'done' || st === 'none')) return
    set({ status: { ...get().status, [id]: 'loading' } })
    try {
      let data: LyricsData | null = opts.force ? null : await window.wave.lyrics.get(id)
      const weak = !!data && (data.syncedSource === 'estimated' || (!data.synced && (data.v ?? 1) < 2))
      if (!data || opts.force || opts.genius || (!data.synced && !data.plain) || weak) data = await window.wave.lyrics.fetch(id, opts)
      get().set(id, data.synced || data.plain || data.geniusNote || data.geniusCandidates?.length ? data : null)
    } catch {
      set({ status: { ...get().status, [id]: 'error' } })
    }
  }
}))

// главный процесс сообщает о ходе синхронизации и о треках, которые только что выровнялись по звуку
if (typeof window !== 'undefined' && window.wave) {
  void window.wave.align.status().then((s) => useLyrics.setState({ align: s })).catch(() => {})
  window.wave.on('align:status', (s) => useLyrics.setState({ align: s }))
  window.wave.on('lyrics:changed', async (id) => {
    if (!(id in useLyrics.getState().byId)) return
    const d = await window.wave.lyrics.get(id).catch(() => null)
    if (d) useLyrics.getState().set(id, d)
  })
}
