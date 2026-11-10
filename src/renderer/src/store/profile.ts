import { create } from 'zustand'
import type { PublishState } from '@shared/api'
import type { ListenInfo, ListenYear, Profile, ShowcaseData } from '@shared/types'
import { resolveShowcase, type ShowcaseCtx } from '@/lib/showcase'
import { useLibrary } from './library'
import { usePlayer } from './player'

interface ProfileState {
  profile: Profile | null
  publish: PublishState | null
  info: ListenInfo | null
  years: Record<number, ListenYear>
  /** растёт при каждой загрузке истории — для пересчёта статистики */
  listensRev: number
  /** открыт экран «Итог года» за этот год */
  wrapped: number | null
  load: () => Promise<void>
  loadListens: (force?: boolean) => Promise<void>
  /** правка профиля: изменения видны сразу, на диск пишутся с задержкой */
  update: (fn: (p: Profile) => void) => void
  replace: (p: Profile) => void
  publishNow: () => Promise<PublishState | null>
  openWrapped: (year?: number) => void
  closeWrapped: () => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let publishTimer: ReturnType<typeof setTimeout> | null = null
let listensAt = 0

export function showcaseCtx(): ShowcaseCtx {
  const lib = useLibrary.getState()
  const pl = usePlayer.getState()
  const s = useProfile.getState()
  return {
    tracks: lib.tracks,
    byId: lib.byId,
    playlists: lib.playlists,
    listens: { info: s.info, years: s.years },
    current: pl.currentId ? lib.byId[pl.currentId] ?? null : null,
    playing: pl.playing
  }
}

export const useProfile = create<ProfileState>((set, get) => {
  const schedulePublish = (delay: number) => {
    if (publishTimer) clearTimeout(publishTimer)
    publishTimer = setTimeout(() => void get().publishNow(), delay)
  }
  const persist = (p: Profile) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void window.wave.profile.set(p).then(() => p.publish || get().publish?.published ? schedulePublish(2500) : undefined)
    }, 500)
  }

  return {
    profile: null,
    publish: null,
    info: null,
    years: {},
    listensRev: 0,
    wrapped: null,

    load: async () => {
      const [profile, publish] = await Promise.all([window.wave.profile.get(), window.wave.profile.publishState()])
      set({ profile, publish })
      void get().loadListens()
      // свежая витрина на сервере после запуска
      if (profile.publish) schedulePublish(8000)
    },

    loadListens: async (force) => {
      if (!force && Date.now() - listensAt < 20_000 && get().info) return
      listensAt = Date.now()
      const info = await window.wave.listens.info()
      const want = new Set([...info.years, new Date().getFullYear()])
      const years: Record<number, ListenYear> = {}
      for (const y of want) years[y] = await window.wave.listens.year(y)
      set((s) => ({ info, years, listensRev: s.listensRev + 1 }))
    },

    update: (fn) => {
      const cur = get().profile
      if (!cur) return
      const next = structuredClone(cur)
      fn(next)
      next.updatedAt = Date.now()
      set({ profile: next })
      persist(next)
    },

    replace: (p) => {
      set({ profile: p })
      persist(p)
    },

    publishNow: async () => {
      const p = get().profile
      if (!p) return null
      await get().loadListens()
      const resolved = resolveShowcase(p, showcaseCtx())
      // «не показывать, что играет»: блок остаётся, но без трека
      if (!p.shareNowPlaying) for (const b of p.blocks) if (b.kind === 'nowPlaying' && resolved[b.id]) resolved[b.id] = { nowPlaying: null }
      const data: ShowcaseData = { profile: p, resolved }
      const st = await window.wave.profile.publish(data).catch((e) => ({ published: false, error: String(e?.message ?? e) }))
      set({ publish: st })
      return st
    },

    openWrapped: (year) => {
      void get().loadListens(true)
      set({ wrapped: year ?? new Date().getFullYear() })
    },
    closeWrapped: () => set({ wrapped: null })
  }
})

// Свежая витрина на сервере: раз в 10 минут и при смене трека (если показываем, что играет).
let lastTrack: string | null = null
let lastNowPublish = 0
setInterval(() => {
  const s = useProfile.getState()
  if (s.profile?.publish) void s.publishNow()
}, 10 * 60_000)
usePlayer.subscribe((st) => {
  const s = useProfile.getState()
  const p = s.profile
  if (!p?.publish || !p.shareNowPlaying || !p.blocks.some((b) => b.kind === 'nowPlaying' && !b.hidden)) return
  const key = `${st.currentId}:${st.playing}`
  if (key === lastTrack) return
  lastTrack = key
  const wait = Math.max(3000, 30_000 - (Date.now() - lastNowPublish))
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = setTimeout(() => {
    lastNowPublish = Date.now()
    void useProfile.getState().publishNow()
  }, wait)
})
window.wave.on('profile:changed', (p) => {
  const cur = useProfile.getState().profile
  if (!cur || p.updatedAt > cur.updatedAt) useProfile.setState({ profile: p })
})
