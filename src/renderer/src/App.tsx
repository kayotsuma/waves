import { useEffect, useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { ScImportDialog } from '@/components/ScImportDialog'
import { Onboarding } from '@/components/Onboarding'
import { ImportDialog } from '@/components/ImportDialog'
import { ModalHost } from '@/components/Modals'
import { NowPlaying } from '@/components/NowPlaying'
import { Wrapped } from '@/components/Wrapped'
import { AccountView, UserView } from '@/views/Account'
import { useProfile } from '@/store/profile'
import { ContextMenu, Toasts } from '@/components/Overlays'
import { PlayerBar } from '@/components/PlayerBar'
import { InfoPanel } from '@/components/InfoPanel'
import { Sidebar, Titlebar } from '@/components/Shell'
import { trackById } from '@/lib/actions'
import { coverColors, hexToRgb } from '@/lib/color'
import { M3_VARS, m3Vars } from '@/lib/m3'
import { coverUrl } from '@/lib/format'
import { syncPlugins } from '@/lib/plugins'
import { startPresence } from '@/lib/presence'
import { FONTS, THEMES } from '@/lib/themes'
import { ROW_H } from '@/lib/format'
import { useDownloads } from '@/store/downloads'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { DownloadsView } from '@/views/Downloads'
import { HomeView } from '@/views/Home'
import { SearchView } from '@/views/Search'
import { GroupView, LibraryView, LikedView, PlaylistView } from '@/views/Library'
import { SettingsView } from '@/views/Settings'

const CUSTOM_VARS = ['--bg', '--bg-rgb', '--panel-solid', '--raised', '--fg', '--fg-2', '--fg-3', '--line']

/** Применяет оформление к документу: тема, акцент, шрифт, скругления, размытие. */
function useAppearance() {
  const ap = useSettings((s) => s.settings.appearance)
  const currentId = usePlayer((s) => s.currentId)
  const track = trackById(currentId)
  const url = coverUrl(track)
  const [colors, setColors] = useState<{ accent: string; palette: string[] } | null>(null)

  useEffect(() => {
    let alive = true
    setColors(null)
    if (url) void coverColors(url).then((c) => alive && setColors(c))
    return () => {
      alive = false
    }
  }, [url])

  const accent = ap.accentFromCover && colors ? colors.accent : ap.accent
  const palette = colors?.palette ?? [ap.accent, '#222', '#111']

  useEffect(() => {
    const r = document.documentElement
    const set = (k: string, v: string) => r.style.setProperty(k, v)
    r.dataset.theme = ap.theme
    const th0 = THEMES.find((t) => t.id === ap.theme)
    const light = !!th0?.light
    // Material You: вся палитра интерфейса строится из цвета обложки (или выбранного акцента)
    let primary = accent
    if (th0?.material) {
      const vars = m3Vars(accent, !light)
      for (const [k, v] of Object.entries(vars)) set(k, v)
      primary = vars['--md-primary']
    } else {
      for (const k of M3_VARS) r.style.removeProperty(k)
    }
    // свои цвета поверх темы
    const c = ap.colors
    const custom: [string, string][] = []
    if (c.bg) custom.push(['--bg', c.bg], ['--bg-rgb', hexToRgb(c.bg).join(' ')])
    if (c.surface) custom.push(['--panel-solid', c.surface], ['--raised', `color-mix(in srgb, ${c.surface} 86%, ${light ? '#000' : '#fff'})`])
    if (c.text) custom.push(['--fg', c.text])
    if (c.text2) custom.push(['--fg-2', c.text2], ['--fg-3', `color-mix(in srgb, ${c.text2} 72%, transparent)`])
    if (c.separator) custom.push(['--line', c.separator])
    const customKeys = new Set(custom.map(([k]) => k))
    if (!th0?.material) for (const k of CUSTOM_VARS) if (!customKeys.has(k)) r.style.removeProperty(k)
    for (const [k, v] of custom) set(k, v)

    r.dataset.material = String(!!th0?.material)
    r.dataset.light = String(light)
    set('--accent', primary)
    set('--accent-rgb', hexToRgb(primary).join(' '))
    // на светлом акценте (например, из светлой обложки) белый текст не читается — берём тёмный
    if (!th0?.material) {
      const [ar, ag, ab] = hexToRgb(primary).map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      const lum = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab
      set('--on-accent', lum > 0.3 ? '#111114' : '#ffffff')
    }
    set('--radius', `${ap.radius}px`)
    set('--radius-lg', `${Math.round(ap.radius * 1.4)}px`)
    set('--radius-sm', `${Math.round(ap.radius * 0.6)}px`)
    set('--r-panel', `${Math.round(ap.radius * 1.4)}px`)
    set('--blur', `${ap.blur}px`)
    set('--dim', String(ap.dim))
    set('--font', FONTS.find((f) => f.id === ap.font)?.css ?? FONTS[0].css)
    set('--fs', String(ap.fontScale))
    set('--title-size', `${ap.titleSize}px`)
    set('--title-weight', String(ap.titleWeight))
    set('--cover-k', String(ap.coverRadius))
    set('--btn-r', ap.buttonShape === 'capsule' ? '999px' : ap.buttonShape === 'rounded' ? `${Math.max(6, Math.round(ap.radius * 0.7))}px` : '4px')
    set('--shadow-k', String(ap.shadows))
    set('--icon-stroke', String(ap.iconStroke))
    set('--anim-k', String(ap.animations ? ap.animSpeed : 0))
    set('--sidebar-full', `${ap.sidebarWidth}px`)
    set('--card-w', `${ap.cardSize}px`)
    set('--row-h', `${ROW_H[ap.density]}px`)
    set('--glass-op', String(ap.glassOpacity))
    set('--glass-sat', String(ap.glassSaturation))
    set('--glass-hl', String(ap.glassHighlight))
    set('--glass-tint', ap.glassTint || 'var(--panel-solid)')
    r.style.zoom = ap.scale === 1 ? '' : String(ap.scale)
    r.dataset.glass = ap.glassStyle
    r.dataset.refract = String(ap.glassStyle === 'liquid' && ap.glassRefraction)
    r.dataset.sidebar = ap.sidebarStyle
    r.dataset.player = ap.playerStyle
    r.dataset.search = ap.searchPlacement
    r.dataset.btn = ap.buttonShape
    r.dataset.sep = String(ap.separators)
    r.dataset.anim = String(ap.animations)
    r.dataset.bgmode = ap.background
    palette.forEach((c, i) => set(`--pal-${i}`, c))
    void window.wave.app.setTitleOverlay('#00000000', light ? '#1b1b26' : '#e8e8f0')
  }, [ap, accent, palette])

  return { ap, url, palette }
}

/** Собственный CSS и плагины из настроек. */
function useExtensions() {
  const ext = useSettings((s) => s.settings.extensions)
  const loaded = useSettings((s) => s.loaded)
  const enabledKey = ext.enabledPlugins.join('|')
  useEffect(() => {
    if (!loaded) return
    let el = document.getElementById('wave-custom-css') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'wave-custom-css'
      document.head.appendChild(el) // последним — чтобы перекрывать тему
    }
    el.textContent = ext.customCss
  }, [ext.customCss, loaded])
  useEffect(() => {
    if (!loaded) return
    void syncPlugins(ext.enabledPlugins).then((reload) => reload && useUI.getState().toast('Плагин отключён — перезагрузите окно (Настройки → Расширения), чтобы он перестал работать', 'info'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, loaded])
}

function Background({ ap, url }: { ap: ReturnType<typeof useAppearance>['ap']; url?: string }) {
  const bgFile = ap.backgroundImage ? `wave://bg/${ap.backgroundImage}` : undefined
  const isVideo = !!ap.backgroundImage && /\.(mp4|m4v|mov|webm)$/i.test(ap.backgroundImage)
  const video = ap.background === 'image' && isVideo ? bgFile : undefined
  const img = ap.background === 'cover' ? url : ap.background === 'image' && !isVideo ? bgFile : undefined
  const ref = useRef<HTMLVideoElement>(null)
  // не жжём CPU/GPU, пока окно свёрнуто
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const sync = () => (document.hidden ? v.pause() : void v.play().catch(() => {}))
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [video])
  return (
    <div className="bg" aria-hidden>
      {img && <div key={img} className="bg-img" style={{ backgroundImage: `url("${img}")` }} />}
      {video && <video key={video} ref={ref} className="bg-img bg-video" src={video} autoPlay loop muted playsInline />}
      {ap.background === 'gradient' && <div className="bg-grad" />}
      <div className="bg-dim" />
    </div>
  )
}

/** SVG-фильтр «преломления» для жидкого стекла: фон под панелью слегка искажается волной. */
function GlassFilters() {
  return (
    <svg className="wave-filters" width="0" height="0" aria-hidden focusable="false">
      <filter id="wave-refract" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="2" seed="11" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="3" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale="46" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

function Routes() {
  const route = useUI((s) => s.route)
  switch (route.name) {
    case 'home':
      return <HomeView />
    case 'library':
      return <LibraryView tab={route.tab} />
    case 'liked':
      return <LikedView />
    case 'search':
      return <SearchView />
    case 'playlist':
      return <PlaylistView id={route.id} />
    case 'album':
      return <GroupView type="album" groupKey={route.key} />
    case 'artist':
      return <GroupView type="artist" groupKey={route.key} />
    case 'downloads':
      return <DownloadsView />
    case 'settings':
      return <SettingsView tab={route.tab} />
    case 'account':
      return <AccountView />
    case 'user':
      return <UserView key={route.username} username={route.username} />
  }
}

function useGlobalEvents() {
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState()
      const p = usePlayer.getState()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.getElementById('global-search')?.focus()
        return
      }
      if (isTyping(e.target) || ui.modal) return
      if (e.code === 'Space') {
        e.preventDefault()
        p.toggle()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') p.next()
      else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') p.prev()
      else if (e.key.toLowerCase() === 'l' && !e.ctrlKey) ui.setNowPlaying(!ui.nowPlaying)
      else if (e.key.toLowerCase() === 'q' && !e.ctrlKey) ui.showQueue()
      else if (e.key === 'Escape') {
        if (ui.importOpen) ui.closeImport()
      }
    }
    // Ссылка, вставленная где угодно (вне полей ввода), открывает импорт.
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const text = e.clipboardData?.getData('text')?.trim() ?? ''
      if (/^(https?:\/\/|spotify:)\S+$/i.test(text)) {
        e.preventDefault()
        useUI.getState().openImport(text)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [])
}

/** Системные медиа-клавиши и виджеты (MPRIS и т. п.). */
function useMediaSession() {
  const currentId = usePlayer((s) => s.currentId)
  const playing = usePlayer((s) => s.playing)
  const track = useLibrary((s) => (currentId ? s.byId[currentId] : undefined))
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    if (!track) return
    const art = coverUrl(track)
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? '',
      artwork: art ? [{ src: art, sizes: '1000x1000', type: 'image/jpeg' }] : []
    })
  }, [track])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const p = usePlayer.getState
    ms.playbackState = playing ? 'playing' : 'paused'
    ms.setActionHandler('play', () => p().toggle())
    ms.setActionHandler('pause', () => p().toggle())
    ms.setActionHandler('previoustrack', () => p().prev())
    ms.setActionHandler('nexttrack', () => p().next())
    ms.setActionHandler('seekto', (d) => d.seekTime != null && p().seek(d.seekTime))
  }, [playing])
}

function DropZone() {
  const [over, setOver] = useState(false)
  const toast = useUI((s) => s.toast)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') || e.dataTransfer?.types.includes('text/uri-list') || e.dataTransfer?.types.includes('text/plain')
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setOver(true) } }
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setOver(false) }
    const overH = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const drop = async (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setOver(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) {
        const paths = files.map((f) => window.wave.app.pathForFile(f)).filter(Boolean)
        toast('Импортирую…')
        const n = await window.wave.library.importLocal(paths)
        toast(n ? `Добавлено треков: ${n}` : 'Аудио и видео не найдены', n ? 'success' : 'info')
        return
      }
      const text = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').trim()
      if (/^(https?:\/\/|spotify:)\S+$/i.test(text)) useUI.getState().openImport(text)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overH)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overH)
      window.removeEventListener('drop', drop)
    }
  }, [toast])
  if (!over) return null
  return (
    <div className="dropzone">
      <UploadCloud size={44} />
      <h2>Отпустите, чтобы добавить</h2>
      <p>Аудио, видео, папки или ссылка</p>
    </div>
  )
}

export function App() {
  const initSettings = useSettings((s) => s.init)
  const initLibrary = useLibrary((s) => s.init)
  const initDownloads = useDownloads((s) => s.init)
  const loaded = useSettings((s) => s.loaded)
  const libLoaded = useLibrary((s) => s.loaded)
  const infoOpen = useUI((s) => s.infoOpen)
  const sidebarFull = useUI((s) => s.sidebarFull)
  const { ap, url } = useAppearance()

  useGlobalEvents()
  useMediaSession()
  useExtensions()
  useEffect(() => startPresence(), [])

  useEffect(() => {
    void initSettings()
    void initLibrary().then(() => usePlayer.getState().restore())
    void initDownloads()
    void useProfile.getState().load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Стартовый экран можно задать хэшем (для разработки): #settings/audio, #library/albums …
  useEffect(() => {
    if (!loaded || !libLoaded) return
    const [name, arg] = location.hash.slice(1).split('/')
    if (name === 'settings') useUI.getState().navigate({ name: 'settings', tab: arg })
    else if (name === 'library') useUI.getState().navigate({ name: 'library', tab: (arg as 'tracks') || 'tracks' })
    else if (name === 'downloads' || name === 'liked') useUI.getState().navigate({ name })
    else if (name === 'account') useUI.getState().navigate({ name: 'account' })
    else if (name === 'wrapped') useProfile.getState().openWrapped(arg ? Number(arg) : undefined)
    else if (name === 'playlist') {
      const p = useLibrary.getState().playlists[0]
      if (p) useUI.getState().navigate({ name: 'playlist', id: p.id })
    } else if (name === 'search') useUI.getState().setQuery(arg ? decodeURIComponent(arg) : '')
    else if (name === 'import') useUI.getState().openImport(arg ? decodeURIComponent(arg) : '')
  }, [loaded, libLoaded])

  if (!loaded || !libLoaded) return <div className="boot" />

  return (
    <div className="app" data-info={infoOpen} data-side={sidebarFull ? 'full' : 'rail'}>
      <Background ap={ap} url={url} />
      <GlassFilters />
      <Titlebar />
      <Sidebar />
      <main className="main panel">
        <Routes />
      </main>
      <InfoPanel />
      <PlayerBar />
      <NowPlaying />
      <Wrapped />
      <ImportDialog />
      <Onboarding />
      <ScImportDialog />
      <ModalHost />
      <ContextMenu />
      <Toasts />
      <DropZone />
    </div>
  )
}
