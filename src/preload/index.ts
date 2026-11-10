import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { WaveApi } from '../shared/api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const api: WaveApi = {
  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('app:openExternal', url),
    showInFolder: (p) => invoke('app:showInFolder', p),
    pickFolder: () => invoke('app:pickFolder'),
    pickAudio: () => invoke('app:pickAudio'),
    pickImage: () => invoke('app:pickImage'),
    pickBackground: () => invoke('app:pickBackground'),
    setTitleOverlay: (color, symbol) => invoke('app:setTitleOverlay', color, symbol),
    pathForFile: (file) => webUtils.getPathForFile(file),
    saveCapture: (rect, name) => invoke('app:saveCapture', rect, name)
  },
  listens: {
    tick: (session, id, at, s) => invoke('listens:tick', session, id, at, s),
    info: () => invoke('listens:info'),
    year: (y) => invoke('listens:year', y)
  },
  profile: {
    get: () => invoke('profile:get'),
    set: (p) => invoke('profile:set', p),
    pickImage: (kind) => invoke('profile:pickImage', kind),
    publish: (d) => invoke('profile:publish', d),
    publishState: () => invoke('profile:publishState'),
    list: () => invoke('profile:list'),
    fetch: (name) => invoke('profile:fetch', name)
  },
  settings: {
    get: () => invoke('settings:get'),
    patch: (p) => invoke('settings:patch', p),
    setBackgroundImage: (p) => invoke('settings:setBackgroundImage', p)
  },
  library: {
    snapshot: () => invoke('library:snapshot'),
    edit: (id, patch) => invoke('library:edit', id, patch),
    remove: (ids, del) => invoke('library:remove', ids, del),
    like: (id) => invoke('library:like', id),
    setDuration: (id, s) => invoke('library:duration', id, s),
    played: (id) => invoke('library:played', id),
    importLocal: (paths) => invoke('library:importLocal', paths),
    trim: (id, start, end) => invoke('library:trim', id, start, end),
    replaceCover: (id, p) => invoke('library:replaceCover', id, p),
    createPlaylist: (name, ids) => invoke('library:pl-create', name, ids),
    renamePlaylist: (id, name) => invoke('library:pl-rename', id, name),
    deletePlaylist: (id) => invoke('library:pl-delete', id),
    addToPlaylist: (id, ids) => invoke('library:pl-add', id, ids),
    removeFromPlaylist: (id, ids) => invoke('library:pl-remove', id, ids),
    reorderPlaylist: (id, ids) => invoke('library:pl-reorder', id, ids)
  },
  imports: {
    resolve: (input) => invoke('import:resolve', input),
    start: (items, opts) => invoke('import:start', items, opts),
    scProfile: (input) => invoke('import:scProfile', input)
  },
  stream: {
    info: (id) => invoke('stream:info', id)
  },
  downloads: {
    list: () => invoke('downloads:list'),
    cancel: (id) => invoke('downloads:cancel', id),
    retry: (id, url) => invoke('downloads:retry', id, url),
    clearFinished: () => invoke('downloads:clear')
  },
  lyrics: {
    get: (id) => invoke('lyrics:get', id),
    fetch: (id, opts) => invoke('lyrics:fetch', id, opts),
    setGeniusUrl: (id, url) => invoke('lyrics:setGeniusUrl', id, url),
    setManual: (id, text) => invoke('lyrics:setManual', id, text),
    setSynced: (id, lines) => invoke('lyrics:setSynced', id, lines),
    setOffset: (id, off) => invoke('lyrics:setOffset', id, off)
  },
  presence: {
    update: (info) => invoke('presence:update', info),
    status: () => invoke('presence:status')
  },
  analysis: {
    get: (id) => invoke('analysis:get', id),
    similar: (id, limit) => invoke('analysis:similar', id, limit)
  },
  align: {
    status: () => invoke('align:status'),
    library: () => invoke('align:library')
  },
  sync: {
    status: () => invoke('sync:status'),
    signIn: (mode, server, username, password) => invoke('sync:signIn', mode, server, username, password),
    signOut: () => invoke('sync:signOut'),
    now: () => invoke('sync:now'),
    setAuto: (auto) => invoke('sync:setAuto', auto),
    downloadMissing: () => invoke('sync:downloadMissing')
  },
  plugins: {
    list: () => invoke('plugins:list'),
    openFolder: () => invoke('plugins:openFolder')
  },
  tools: {
    status: () => invoke('tools:status'),
    ensure: () => invoke('tools:ensure'),
    updateYtDlp: () => invoke('tools:updateYtDlp'),
    yandexLogin: () => invoke('tools:yandexLogin')
  },
  on: ((channel: string, cb: (...args: any[]) => void) => {
    const handler = (_e: unknown, ...args: any[]) => cb(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }) as WaveApi['on']
}

contextBridge.exposeInMainWorld('wave', api)
