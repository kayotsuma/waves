import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import { createReadStream, copyFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { DownloadJob, ImportItem, Playlist, Settings } from '@shared/types'
import { LibraryService } from './library'
import { backgroundsDir, coversDir, dataDir, defaultMusicDir, ensureDirs, pluginsDir } from './paths'
import { SettingsService } from './settings'
import { AnalysisService } from './services/analysis'
import { DiscordPresence } from './services/discord'
import { Binaries } from './services/binaries'
import { DownloadManager } from './services/downloader'
import { importLocalFiles, replaceCover } from './services/localImport'
import { LyricsService } from './services/lyrics'
import { AlignerService } from './services/aligner'
import { ensureExamplePlugin, listPlugins } from './services/plugins'
import { trimTrack } from './services/trim'
import { Resolver } from './services/resolver'
import { SyncService } from './services/sync'
import { ListensService } from './services/listens'
import { ProfileService } from './services/profile'
import { YANDEX_AUTH_URL } from './services/sources/yandex'
import { YtDlp } from './services/ytdlp'
import { StreamService } from './services/stream'
import { resolveScProfile } from './services/sources/generic'
import { errMsg } from './util'

const isDev = !app.isPackaged

// Только для разработки: отдельный каталог данных, чтобы тесты не трогали настоящую библиотеку.
if (isDev && process.env['WAVE_USER_DATA']) app.setPath('userData', process.env['WAVE_USER_DATA'])

protocol.registerSchemesAsPrivileged([
  { scheme: 'wave', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }
])

app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win: BrowserWindow | null = null
const send = (channel: string, ...args: unknown[]) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args)
}

const MIME: Record<string, string> = {
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.mka': 'audio/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
}

/** Типы для фона (видео отдаём как video/*, а не audio/mp4). */
const BG_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.webm': 'video/webm'
}
const BG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'm4v', 'mov', 'webm']

function serveFile(file: string, req: Request, extra: Record<string, string> = {}): Response {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } })
  }
  const base: Record<string, string> = {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    ...extra
  }
  const range = req.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (m) {
      let start = m[1] === '' ? size - Number(m[2]) : Number(m[1])
      let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2])
      start = Math.max(0, start)
      end = Math.min(size - 1, end)
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
      }
      const stream = createReadStream(file, { start, end })
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      })
    }
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    status: 200,
    headers: { ...base, 'Content-Length': String(size) }
  })
}

async function main(): Promise<void> {
  await app.whenReady()
  ensureDirs()
  ensureExamplePlugin()
  cleanTmp()

  const settings = new SettingsService()
  const lib = new LibraryService()
  const bins = new Binaries()
  const yt = new YtDlp(bins, () => settings.get())
  const lyrics = new LyricsService(lib, settings, async (id) => (await analysis.get(id))?.peaks ?? null)
  const resolver = new Resolver(yt, lib, () => settings.get().download.yandexToken)
  const downloads = new DownloadManager({ yt, bins, lib, settings, lyrics })
  const stream = new StreamService(yt)
  const sync = new SyncService(lib, settings)
  const listens = new ListensService(lib)
  const profile = new ProfileService(lib, sync)
  profile.onChange = (p) => send('profile:changed', p)
  const analysis = new AnalysisService(lib, bins)
  const aligner = new AlignerService(lib, lyrics, bins, settings)
  let alignOn = settings.get().download.alignLyrics !== false
  lyrics.onNeedsAlign = (id, urgent) => aligner.enqueue(id, urgent)
  aligner.onStatus = (s) => send('align:status', s)
  aligner.onAligned = (id) => send('lyrics:changed', id)
  const presence = new DiscordPresence(() => settings.get().integrations.discord)
  let discordCfg = JSON.stringify(settings.get().integrations.discord)
  sync.enqueue = (items) => downloads.enqueue(items, {}).length
  sync.onStatus = (s) => send('sync:status', s)

  lib.onTrack = (kind, track) => {
    send('library:track', { kind, track })
    sync.touch()
    if (kind === 'upsert') analysis.enqueue(track.id)
  }
  lib.onPlaylists = (pls: Playlist[]) => {
    send('library:playlists', pls)
    sync.touch()
  }
  lib.onRemoved = (tracks) => sync.noteRemoved(tracks)
  lib.onPlaylistDeleted = (id) => sync.notePlaylistDeleted(id)
  bins.onStatus = (s) => send('tools:status', s)
  downloads.onUpdate = (job: DownloadJob) => send('downloads:update', job)
  downloads.onRemove = (ids) => send('downloads:removed', ids)
  settings.onChange = (s: Settings) => {
    send('settings:changed', s)
    sync.noteSettings()
    const on = s.download.alignLyrics !== false
    if (on !== alignOn) {
      alignOn = on
      aligner.setEnabled(on)
    }
    const cfg = JSON.stringify(s.integrations.discord)
    if (cfg !== discordCfg) {
      discordCfg = cfg
      presence.configChanged()
    }
  }

  // ───── протокол wave:// ─────
  protocol.handle('wave', (req) => {
    const url = new URL(req.url)
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    switch (url.hostname) {
      case 'track': {
        const t = lib.get(id)
        if (!t) return new Response('Not found', { status: 404 })
        return t.remote ? stream.serve(t, req) : serveFile(t.file, req, { 'Cache-Control': 'no-store' })
      }
      case 'hls': {
        // wave://hls/<id>/index.m3u8[?u=<адрес плейлиста варианта>]
        const t = lib.get(id.split('/')[0])
        if (!t?.remote) return new Response('Not found', { status: 404 })
        const u = url.searchParams.get('u')
        return stream.serveManifest(t, u ? Buffer.from(u, 'base64url').toString('utf8') : null, req)
      }
      case 'hlsseg': {
        const t = lib.get(id)
        const u = url.searchParams.get('u')
        if (!t?.remote || !u) return new Response('Not found', { status: 404 })
        return stream.serveSegment(t, u, req)
      }
      case 'cover': {
        const t = lib.get(id)
        if (!t?.hasCover) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } })
        return serveFile(join(coversDir(), `${id}.jpg`), req, { 'Cache-Control': 'public, max-age=31536000, immutable' })
      }
      case 'bg': {
        if (!/^[\w.-]+$/.test(id)) return new Response('Bad request', { status: 400 })
        const mime = BG_MIME[extname(id).toLowerCase()]
        return serveFile(join(backgroundsDir(), id), req, { 'Cache-Control': 'public, max-age=3600', ...(mime ? { 'Content-Type': mime } : {}) })
      }
      case 'plugin': {
        // wave://plugin/<id>/<файл>: только файлы внутри папки плагина
        const parts = id.split('/')
        if (parts.length < 2 || parts.some((p) => !/^[\w.-]+$/.test(p) || p === '..' || p === '.')) return new Response('Bad request', { status: 400 })
        return serveFile(join(pluginsDir(), ...parts), req, { 'Cache-Control': 'no-store' })
      }
      default:
        return new Response('Not found', { status: 404 })
    }
  })

  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' wave:; style-src 'self' 'unsafe-inline'; img-src 'self' wave: data: blob: https:; " +
              "media-src 'self' wave: blob:; connect-src 'self' wave:; font-src 'self' data:; object-src 'none'; base-uri 'none'"
          ]
        }
      })
    })
  }
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  // ───── IPC ─────
  const str = (v: unknown): string => {
    if (typeof v !== 'string') throw new Error('Некорректный аргумент')
    return v
  }
  const strs = (v: unknown): string[] => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error('Некорректный аргумент')
    return v as string[]
  }
  const handle = (ch: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(ch, async (_e, ...args) => {
      try {
        return await fn(...args)
      } catch (e) {
        console.error(`[ipc ${ch}]`, e)
        throw new Error(errMsg(e))
      }
    })

  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir: dataDir(), defaultMusicDir: defaultMusicDir() }))
  handle('app:openExternal', (url) => {
    if (/^https?:\/\//i.test(str(url))) return shell.openExternal(url)
  })
  handle('app:showInFolder', (p) => shell.showItemInFolder(str(p)))
  handle('app:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('app:pickAudio', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Аудио и видео', extensions: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav', 'webm', 'aiff', 'mp4', 'm4v', 'mov', 'mkv', 'avi', 'flv', 'wmv', '3gp', 'mpg', 'mpeg'] }
      ]
    })
    return r.canceled ? [] : r.filePaths
  })
  handle('app:pickImage', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('app:pickBackground', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Изображения, GIF и видео', extensions: BG_EXTS }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('app:setTitleOverlay', (color, symbol) => {
    if (process.platform !== 'darwin') win?.setTitleBarOverlay({ color: str(color), symbolColor: str(symbol), height: 44 })
  })

  handle('settings:get', () => settings.get())
  handle('settings:patch', (p) => settings.patch(p))
  handle('settings:setBackgroundImage', (p: string | null) => {
    for (const f of readdirSync(backgroundsDir())) rmSync(join(backgroundsDir(), f), { force: true })
    if (!p) {
      settings.patch({ appearance: { backgroundImage: undefined, background: 'cover' } })
      return null
    }
    const ext = extname(str(p)).toLowerCase()
    if (!BG_EXTS.includes(ext.slice(1))) throw new Error('Формат не поддерживается: нужен jpg, png, webp, gif, mp4 или webm')
    const name = `bg-${Date.now()}${ext}`
    copyFileSync(p, join(backgroundsDir(), name))
    settings.patch({ appearance: { backgroundImage: name, background: 'image' } })
    return name
  })

  handle('library:snapshot', () => lib.snapshot())
  handle('library:edit', (id, patch) => lib.edit(str(id), patch ?? {}))
  handle('library:remove', (ids, del) => lib.remove(strs(ids), !!del))
  handle('library:like', (id) => lib.toggleLike(str(id)))
  handle('stream:info', async (id) => {
    const t = lib.get(str(id))
    if (!t?.remote) throw new Error('Это не веб-трек')
    return stream.info(t)
  })
  handle('library:duration', (id, d) => {
    const t = lib.get(str(id))
    const n = Number(d)
    if (t?.remote && Number.isFinite(n) && n > 0 && n < 24 * 3600 && Math.abs(n - t.duration) > 1) lib.update(t.id, { duration: n })
  })
  handle('library:played', (id) => lib.recordPlay(str(id)))
  handle('library:importLocal', async (paths) => (await importLocalFiles(strs(paths), lib, bins, settings.get().download.musicDir)).length)
  handle('library:replaceCover', async (id, p) => {
    const ff = bins.ffmpegPath
    const t = lib.get(str(id))
    if (!ff || !t) return false
    const ok = await replaceCover(ff, t.id, str(p))
    if (ok) lib.update(t.id, { hasCover: true, coverRev: t.coverRev + 1 })
    return ok
  })
  handle('library:trim', (id, start, end) => trimTrack(lib, bins, settings.get().download.musicDir, str(id), Number(start), Number(end)))
  handle('library:pl-create', (name, ids) => lib.createPlaylist(str(name), ids ? strs(ids) : []))
  handle('library:pl-rename', (id, name) => lib.renamePlaylist(str(id), str(name)))
  handle('library:pl-delete', (id) => lib.deletePlaylist(str(id)))
  handle('library:pl-add', (id, ids) => lib.addToPlaylist(str(id), strs(ids)))
  handle('library:pl-remove', (id, ids) => lib.removeFromPlaylist(str(id), strs(ids)))
  handle('library:pl-reorder', (id, ids) => lib.reorderPlaylist(str(id), strs(ids)))

  handle('import:resolve', (input) => resolver.resolve(str(input)))
  handle('import:scProfile', (input) => resolveScProfile(str(input), yt))
  handle('import:start', (items: ImportItem[], opts?: { playlistName?: string; playlistId?: string; like?: boolean; stream?: boolean }) => {
    if (!Array.isArray(items)) throw new Error('Некорректный список')
    let playlistId = opts?.playlistId
    if (!playlistId && opts?.playlistName) playlistId = lib.createPlaylist(opts.playlistName).id
    const o = { playlistId, like: opts?.like === true }
    if (opts?.stream === true) {
      const r = downloads.addRemote(items, o)
      return r.added + downloads.enqueue(r.download, o).length
    }
    return downloads.enqueue(items, o).length
  })

  handle('downloads:list', () => downloads.list())
  handle('downloads:cancel', (id) => downloads.cancel(str(id)))
  handle('downloads:retry', (id, url) => downloads.retry(str(id), typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined))
  handle('downloads:clear', () => downloads.clearFinished())

  handle('presence:update', (info) => {
    if (info === null) return presence.update(null)
    const i = info as Record<string, unknown>
    presence.update({
      title: String(i.title ?? '').slice(0, 200),
      artist: String(i.artist ?? '').slice(0, 200),
      duration: Math.max(0, Number(i.duration) || 0),
      position: Math.max(0, Number(i.position) || 0),
      playing: i.playing === true,
      url: typeof i.url === 'string' && /^https:\/\//.test(i.url) ? i.url : undefined
    })
  })
  handle('presence:status', () => presence.status())
  handle('analysis:get', (id) => analysis.get(str(id)))
  handle('align:status', () => aligner.status())
  handle('align:library', () => aligner.enqueueLibrary())
  handle('analysis:similar', (id, limit) => analysis.similar(str(id), Math.min(30, Math.max(1, Number(limit) || 8))))

  handle('lyrics:get', (id) => lyrics.get(str(id)))
  handle('lyrics:fetch', (id, opts) => lyrics.fetch(str(id), opts ?? {}))
  handle('lyrics:setGeniusUrl', (id, url) => lyrics.setGeniusUrl(str(id), str(url)))
  handle('lyrics:setManual', (id, text) => lyrics.setManual(str(id), str(text)))
  handle('lyrics:setSynced', (id, lines) => lyrics.setSynced(str(id), lines))
  handle('lyrics:setOffset', (id, off) => lyrics.setOffset(str(id), Number(off) || 0))

  handle('sync:status', () => sync.status())
  handle('sync:signIn', (mode, server, user, pass) => {
    if (mode !== 'register' && mode !== 'login') throw new Error('Некорректный аргумент')
    return sync.signIn(mode, str(server), str(user), str(pass))
  })
  handle('sync:signOut', () => sync.signOut())
  handle('sync:now', () => sync.sync())
  handle('sync:setAuto', (v) => sync.setAuto(!!v))
  handle('sync:downloadMissing', () => sync.downloadMissing())

  handle('listens:tick', (session, id, at, s) => listens.tick(str(session).slice(0, 80), str(id), Number(at) || Date.now(), Number(s) || 0))
  handle('listens:info', () => listens.info())
  handle('listens:year', (y) => listens.get(Math.round(Number(y)) || new Date().getFullYear()))

  handle('profile:get', () => profile.get())
  handle('profile:set', (p) => profile.set(p))
  handle('profile:pickImage', async (kind) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Изображения и GIF', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] })
    return r.canceled ? null : profile.loadImage(r.filePaths[0], kind === 'banner' ? 'banner' : 'avatar')
  })
  handle('profile:publish', (data) => profile.publish(data))
  handle('profile:publishState', () => profile.publishState())
  handle('profile:list', () => profile.list())
  handle('profile:fetch', (name) => profile.fetch(str(name)))

  // снимок части окна в PNG (карточка итогов года, витрина)
  handle('app:saveCapture', async (rect, name) => {
    if (!win) return null
    const r = rect as { x: number; y: number; width: number; height: number }
    const b = win.getContentBounds()
    const box = {
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y)),
      width: Math.max(1, Math.min(b.width, Math.round(r.width))),
      height: Math.max(1, Math.min(b.height, Math.round(r.height)))
    }
    const img = await win.webContents.capturePage(box)
    const safe = str(name).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Wave'
    const res = await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('pictures'), `${safe}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, img.toPNG())
    return res.filePath
  })

  handle('plugins:list', () => listPlugins(settings.get().extensions.enabledPlugins))
  handle('plugins:openFolder', () => shell.openPath(pluginsDir()))

  handle('tools:status', () => bins.getStatus())
  handle('tools:ensure', () => bins.ensure(settings.get().download.autoUpdateYtDlp))
  handle('tools:updateYtDlp', () => bins.forceUpdate())
  handle('tools:yandexLogin', () => yandexLogin(win))

  createWindow()
  sync.start()
  analysis.startBackground()
  aligner.startBackground()
  setTimeout(() => downloads.backfillCovers(), 15_000).unref?.()
  presence.configChanged()
  if (!(isDev && process.env['WAVE_NO_TOOLS'])) void bins.ensure(settings.get().download.autoUpdateYtDlp)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.on('before-quit', () => {
    sync.stop()
    listens.flush()
    downloads.flush()
    profile.flush()
    analysis.stop()
    aligner.stop()
    presence.stop()
    settings.flush()
    lib.flush()
  })
}

function cleanTmp(): void {
  try {
    rmSync(join(dataDir(), 'tmp'), { recursive: true, force: true })
    ensureDirs()
  } catch {
    /* ignore */
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b12',
    title: 'Wave',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e8e8f0', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (!(dev && url.startsWith(dev)) && !url.startsWith('file://')) e.preventDefault()
  })

  const dev = process.env['ELECTRON_RENDERER_URL']
  const hash = process.env['WAVE_HASH'] ? `#${process.env['WAVE_HASH']}` : ''
  if (isDev && dev) void win.loadURL(dev + hash)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash.slice(1) })

  // Только для разработки: сделать скриншот и выйти (WAVE_SHOT=/путь/к/файлу.png)
  const shot = process.env['WAVE_SHOT']
  if (isDev && shot) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, Number(process.env['WAVE_SHOT_DELAY']) || 2500))
      const js = process.env['WAVE_JS']
      if (js) {
        try {
          const out = await win!.webContents.executeJavaScript(js)
          if (out !== undefined) console.log('[WAVE_JS]', JSON.stringify(out))
        } catch (e) {
          console.log('[WAVE_JS error]', errMsg(e))
        }
        await new Promise((r) => setTimeout(r, Number(process.env['WAVE_JS_DELAY']) || 1500))
      }
      win!.show()
      // дожидаемся реальной отрисовки (в средах без GPU кадры могут сильно запаздывать)
      await win!.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
      win!.webContents.invalidate()
      await new Promise((r) => setTimeout(r, 1200))
      await win!.webContents.capturePage()
      win!.webContents.invalidate()
      await new Promise((r) => setTimeout(r, 1200))
      const img = await win!.webContents.capturePage()
      writeFileSync(shot, img.toPNG())
      app.quit()
    })
  }
}

function yandexLogin(parent: BrowserWindow | null): Promise<string | null> {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent: parent ?? undefined,
      modal: !!parent,
      width: 520,
      height: 720,
      title: 'Вход в Яндекс',
      autoHideMenuBar: true,
      webPreferences: { partition: 'yandex-login', sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    let done = false
    const finish = (token: string | null) => {
      if (done) return
      done = true
      resolve(token)
      if (!w.isDestroyed()) w.close()
      void session.fromPartition('yandex-login').clearStorageData()
    }
    const check = (url: string) => {
      const m = url.match(/[#&?]access_token=([^&]+)/)
      if (m) finish(decodeURIComponent(m[1]))
    }
    w.webContents.on('will-redirect', (_e, url) => check(url))
    w.webContents.on('did-navigate', (_e, url) => check(url))
    w.webContents.on('did-navigate-in-page', (_e, url) => check(url))
    w.on('closed', () => finish(null))
    void w.loadURL(YANDEX_AUTH_URL)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

main().catch((e) => {
  console.error('[fatal]', e)
  app.quit()
})
