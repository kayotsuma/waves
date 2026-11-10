import { create } from 'zustand'
import type { Track } from '@shared/types'

export type Route =
  | { name: 'home' }
  | { name: 'library'; tab?: 'tracks' | 'albums' | 'artists' }
  | { name: 'liked' }
  | { name: 'search' }
  | { name: 'playlist'; id: string }
  | { name: 'album'; key: string }
  | { name: 'artist'; key: string }
  | { name: 'downloads' }
  | { name: 'settings'; tab?: string }
  | { name: 'account' }
  | { name: 'user'; username: string }

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
}

export interface MenuItem {
  label?: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  onClick?: () => void
  children?: MenuItem[]
}

export type Modal =
  | { kind: 'edit-track'; track: Track }
  | { kind: 'pick-playlist'; trackIds: string[] }
  | { kind: 'new-playlist'; trackIds: string[] }
  | { kind: 'confirm'; title: string; text: string; confirmLabel: string; danger?: boolean; onConfirm: () => void }
  | { kind: 'sync-editor'; track: Track }
  | { kind: 'lyrics-paste'; track: Track }
  | { kind: 'trim'; track: Track }
  | { kind: 'rename-playlist'; id: string; name: string }
  | { kind: 'manual-url'; jobId: string }
  | { kind: 'prompt'; title: string; initial?: string; placeholder?: string; confirmLabel: string; onSubmit: (v: string) => void }

interface UIState {
  route: Route
  back: Route[]
  forward: Route[]
  query: string
  nowPlaying: boolean
  queueOpen: boolean
  /** боковая панель развёрнута (подписи и плейлисты) или свёрнута в рейку из иконок */
  sidebarFull: boolean
  /** правая панель «Сейчас играет» */
  infoOpen: boolean
  /** вкладка панели «Медиатека» */
  libTab: 'playlists' | 'albums' | 'queue'
  importOpen: boolean
  importPrefill: string
  scImportOpen: boolean
  toasts: Toast[]
  menu: { x: number; y: number; items: MenuItem[] } | null
  modal: Modal | null
  navigate: (r: Route) => void
  goBack: () => void
  goForward: () => void
  setQuery: (q: string) => void
  setNowPlaying: (v: boolean) => void
  setQueueOpen: (v: boolean) => void
  setSidebarFull: (v: boolean) => void
  setInfoOpen: (v: boolean) => void
  setLibTab: (t: 'playlists' | 'albums' | 'queue') => void
  showQueue: () => void
  openImport: (prefill?: string) => void
  closeImport: () => void
  setScImportOpen: (v: boolean) => void
  toast: (text: string, kind?: Toast['kind']) => void
  openMenu: (x: number, y: number, items: MenuItem[]) => void
  closeMenu: () => void
  openModal: (m: Modal) => void
  closeModal: () => void
}

let toastId = 1

const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b)

export const useUI = create<UIState>((set, get) => ({
  route: { name: 'home' },
  back: [],
  forward: [],
  query: '',
  nowPlaying: false,
  queueOpen: false,
  sidebarFull: (() => {
    try {
      return localStorage.getItem('wave.sidebarFull') === '1'
    } catch {
      return false
    }
  })(),
  infoOpen: (() => {
    try {
      return localStorage.getItem('wave.infoOpen') !== '0'
    } catch {
      return true
    }
  })(),
  libTab: 'playlists',
  importOpen: false,
  importPrefill: '',
  scImportOpen: false,
  toasts: [],
  menu: null,
  modal: null,
  navigate: (r) => {
    const { route, back } = get()
    if (sameRoute(route, r)) return
    set({ route: r, back: [...back.slice(-40), route], forward: [], nowPlaying: false })
  },
  goBack: () => {
    const { back, route, forward } = get()
    if (!back.length) return
    set({ route: back[back.length - 1], back: back.slice(0, -1), forward: [route, ...forward] })
  },
  goForward: () => {
    const { forward, route, back } = get()
    if (!forward.length) return
    set({ route: forward[0], forward: forward.slice(1), back: [...back, route] })
  },
  setQuery: (query) => {
    set({ query })
    const { route, navigate } = get()
    if (query && route.name !== 'search') navigate({ name: 'search' })
  },
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  setQueueOpen: (queueOpen) => set({ queueOpen }),
  setSidebarFull: (sidebarFull) => {
    set({ sidebarFull })
    try {
      localStorage.setItem('wave.sidebarFull', sidebarFull ? '1' : '0')
    } catch {
      /* ignore */
    }
  },
  setInfoOpen: (infoOpen) => {
    set({ infoOpen })
    try {
      localStorage.setItem('wave.infoOpen', infoOpen ? '1' : '0')
    } catch {
      /* ignore */
    }
  },
  setLibTab: (libTab) => set({ libTab }),
  showQueue: () => {
    const { sidebarFull, libTab, setSidebarFull } = get()
    if (sidebarFull && libTab === 'queue') return set({ libTab: 'playlists' })
    setSidebarFull(true)
    set({ libTab: 'queue' })
  },
  openImport: (prefill = '') => set({ importOpen: true, importPrefill: prefill }),
  closeImport: () => set({ importOpen: false, importPrefill: '' }),
  setScImportOpen: (scImportOpen) => set(scImportOpen ? { scImportOpen, importOpen: false } : { scImportOpen }),
  toast: (text, kind = 'info') => {
    const id = toastId++
    set({ toasts: [...get().toasts, { id, text, kind }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 6500 : 3500)
  },
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
  openModal: (modal) => set({ modal, menu: null }),
  closeModal: () => set({ modal: null })
}))
