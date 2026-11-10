import { create } from 'zustand'
import type { BinariesStatus, DownloadJob } from '@shared/types'

interface DownloadsState {
  jobs: Record<string, DownloadJob>
  tools: BinariesStatus | null
  init: () => Promise<void>
}

export const useDownloads = create<DownloadsState>((set, get) => ({
  jobs: {},
  tools: null,
  init: async () => {
    const list = await window.wave.downloads.list()
    set({ jobs: Object.fromEntries(list.map((j) => [j.id, j])), tools: await window.wave.tools.status() })
    window.wave.on('downloads:update', (job) => set({ jobs: { ...get().jobs, [job.id]: { ...job } } }))
    window.wave.on('downloads:removed', (ids) => {
      const jobs = { ...get().jobs }
      ids.forEach((id) => delete jobs[id])
      set({ jobs })
    })
    window.wave.on('tools:status', (tools) => set({ tools }))
  }
}))

export const activeStatuses = new Set(['queued', 'matching', 'downloading', 'processing'])
