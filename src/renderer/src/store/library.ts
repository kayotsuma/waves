import { create } from 'zustand'
import type { Playlist, Track } from '@shared/types'

interface LibraryState {
  tracks: Track[]
  byId: Record<string, Track>
  playlists: Playlist[]
  loaded: boolean
  init: () => Promise<void>
}

export const useLibrary = create<LibraryState>((set, get) => {
  let pending = new Map<string, Track | null>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    const byId = { ...get().byId }
    for (const [id, t] of pending) {
      if (t) byId[id] = t
      else delete byId[id]
    }
    pending = new Map()
    set({ byId, tracks: Object.values(byId) })
  }

  return {
    tracks: [],
    byId: {},
    playlists: [],
    loaded: false,
    init: async () => {
      const snap = await window.wave.library.snapshot()
      const byId: Record<string, Track> = {}
      for (const t of snap.tracks) byId[t.id] = t
      set({ byId, tracks: snap.tracks, playlists: snap.playlists, loaded: true })
      window.wave.on('library:track', ({ kind, track }) => {
        pending.set(track.id, kind === 'upsert' ? track : null)
        if (!timer) timer = setTimeout(flush, 120)
      })
      window.wave.on('library:playlists', (playlists) => set({ playlists }))
    }
  }
})
