import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { DeepPartial, Settings } from '@shared/types'

function merge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch as T
  const out: any = { ...(base as any) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      delete out[k]
      continue
    }
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k], v) : v
  }
  return out
}

interface SettingsState {
  settings: Settings
  loaded: boolean
  init: () => Promise<void>
  patch: (p: DeepPartial<Settings>) => void
  reload: () => Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS(''),
  loaded: false,
  init: async () => {
    set({ settings: await window.wave.settings.get(), loaded: true })
  },
  reload: async () => set({ settings: await window.wave.settings.get() }),
  patch: (p) => {
    set({ settings: merge(get().settings, p) })
    void window.wave.settings.patch(p)
  }
}))
