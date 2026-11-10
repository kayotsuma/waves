import { join } from 'node:path'
import type { DeepPartial, ImportItem, Playlist, Settings, SyncStatus, Track, TrackSource } from '@shared/types'
import type { LibraryService } from '../library'
import { dataDir } from '../paths'
import type { SettingsService } from '../settings'
import { JsonStore } from '../store'
import { errMsg } from '../util'

/**
 * Клиент синхронизации. Синхронизируется описание библиотеки: треки (название, источник, «любимое», счётчик),
 * плейлисты и настройки оформления/звука. Аудиофайлы не передаются — на другом устройстве недостающие треки
 * можно скачать заново по их источнику. Токены сервисов и пути к папкам не синхронизируются.
 * Слияние выполняется на клиенте, сервер лишь хранит документ с номером ревизии.
 */

interface RemoteTrack {
  title: string
  artist: string
  artists: string[]
  album?: string
  year?: number
  duration: number
  source: TrackSource
  addedAt: number
  plays: number
  liked: boolean
  likedAt?: number
}

interface RemotePlaylist {
  id: string
  name: string
  keys: string[]
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

type SyncedSettings = Pick<Settings, 'appearance'> & { audio: Omit<Settings['audio'], 'volume' | 'muted' | 'outputDeviceId'>; customCss: string }

interface SyncDoc {
  v: 1
  tracks: Record<string, RemoteTrack>
  /** удалено пользователем: ключ трека → время */
  removed: Record<string, number>
  playlists: Record<string, RemotePlaylist>
  settings?: { at: number; value: SyncedSettings }
}

interface SyncState {
  server: string
  username: string
  token: string
  rev: number
  auto: boolean
  lastSync?: number
  error?: string
  removed: Record<string, number>
  deletedPlaylists: Record<string, number>
  settingsAt: number
  settingsHash: string
  /** треки с других устройств, которых здесь нет */
  pending: Record<string, RemoteTrack>
  /** ключи треков плейлиста, которых на этом устройстве пока нет */
  playlistExtra: Record<string, string[]>
}

const fresh = (): SyncState => ({
  server: '',
  username: '',
  token: '',
  rev: 0,
  auto: true,
  removed: {},
  deletedPlaylists: {},
  settingsAt: 0,
  settingsHash: '',
  pending: {},
  playlistExtra: {}
})

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export function trackKey(t: { source: TrackSource; artist: string; title: string }): string {
  if (t.source.id && t.source.kind !== 'local') return `${t.source.kind}:${t.source.id}`
  return `meta:${norm(t.artist)}|${norm(t.title)}`
}

/** JSON с отсортированными ключами — чтобы сравнивать документы независимо от порядка полей. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val
  )
}

/** Документ с сервера может быть пустым или повреждённым — приводим к безопасному виду. */
function normalizeDoc(raw: unknown): SyncDoc | null {
  const d = raw as Partial<SyncDoc> | null
  if (!d || typeof d !== 'object' || d.v !== 1) return null
  const obj = <T>(v: unknown): Record<string, T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {})
  const tracks: Record<string, RemoteTrack> = {}
  for (const [k, t] of Object.entries(obj<RemoteTrack>(d.tracks))) {
    if (t && typeof t.title === 'string' && t.source && typeof t.source === 'object') {
      tracks[k] = { ...t, artists: Array.isArray(t.artists) ? t.artists : [t.artist ?? ''], artist: t.artist ?? '', addedAt: Number(t.addedAt) || 0, plays: Number(t.plays) || 0, liked: !!t.liked, duration: Number(t.duration) || 0 }
    }
  }
  const playlists: Record<string, RemotePlaylist> = {}
  for (const [k, p] of Object.entries(obj<RemotePlaylist>(d.playlists))) {
    if (p && typeof p.id === 'string') playlists[k] = { ...p, name: String(p.name ?? ''), keys: Array.isArray(p.keys) ? p.keys.filter((x) => typeof x === 'string') : [], createdAt: Number(p.createdAt) || 0, updatedAt: Number(p.updatedAt) || 0 }
  }
  const settings = d.settings && typeof d.settings === 'object' && d.settings.value && typeof d.settings.value === 'object' ? { at: Number(d.settings.at) || 0, value: d.settings.value } : undefined
  return { v: 1, tracks, removed: obj<number>(d.removed), playlists, settings }
}

function isPrivateHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]'
  )
}

export function normalizeServer(input: string): string {
  let s = input.trim()
  if (!s) throw new Error('Укажите адрес сервера.')
  if (!/^https?:\/\//i.test(s)) s = `${/^(localhost|127\.|10\.|192\.168\.)/.test(s) ? 'http' : 'https'}://${s}`
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new Error('Некорректный адрес сервера.')
  }
  if (u.protocol === 'http:' && !isPrivateHost(u.hostname)) {
    throw new Error('Для сервера в интернете нужен HTTPS: иначе пароль уйдёт по сети открытым текстом.')
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
}

export class SyncService {
  private store: JsonStore<SyncState>
  private syncing = false
  private applying = false
  private timer: NodeJS.Timeout | null = null
  private interval: NodeJS.Timeout | null = null
  onStatus: (s: SyncStatus) => void = () => {}
  /** Поставить скачивание недостающих треков (подключается из main). */
  enqueue: (items: ImportItem[]) => number = () => 0

  constructor(
    private lib: LibraryService,
    private settings: SettingsService
  ) {
    this.store = new JsonStore<SyncState>(join(dataDir(), 'sync.json'), fresh(), (l, d) => ({ ...d, ...(l as Partial<SyncState>) }))
    this.st.settingsHash = this.st.settingsHash || canon(this.syncedSettings())
  }

  private get st(): SyncState {
    return this.store.data
  }

  status(): SyncStatus {
    const s = this.st
    return {
      signedIn: !!s.token,
      server: s.server || undefined,
      username: s.username || undefined,
      auto: s.auto,
      syncing: this.syncing,
      lastSync: s.lastSync,
      error: s.error,
      pending: Object.keys(s.pending).length
    }
  }

  private emit(): void {
    this.onStatus(this.status())
  }

  /** Запускает автосинхронизацию, если выполнен вход. */
  start(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = setInterval(() => void this.auto(), 5 * 60_000)
    this.interval.unref()
    setTimeout(() => void this.auto(), 4000).unref()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.interval) clearInterval(this.interval)
    this.store.flush()
  }

  private async auto(): Promise<void> {
    if (this.st.token && this.st.auto) await this.sync().catch(() => {})
  }

  // ───── отслеживание локальных изменений ─────

  /** Что-то изменилось локально: запланировать синхронизацию. */
  touch(): void {
    if (this.applying || !this.st.token || !this.st.auto) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.auto(), 10_000)
    this.timer.unref()
  }

  noteRemoved(tracks: Track[]): void {
    const now = Date.now()
    for (const t of tracks) this.st.removed[trackKey(t)] = now
    this.store.save()
    this.touch()
  }

  notePlaylistDeleted(id: string): void {
    this.st.deletedPlaylists[id] = Date.now()
    delete this.st.playlistExtra[id]
    this.store.save()
    this.touch()
  }

  noteSettings(): void {
    if (this.applying) return
    const h = canon(this.syncedSettings())
    if (h === this.st.settingsHash) return
    this.st.settingsHash = h
    this.st.settingsAt = Date.now()
    this.store.save()
    this.touch()
  }

  // ───── аккаунт ─────

  async signIn(mode: 'register' | 'login', serverInput: string, username: string, password: string): Promise<SyncStatus> {
    const server = normalizeServer(serverInput)
    const res = await this.request(server, `/api/${mode}`, 'POST', undefined, { username, password })
    Object.assign(this.st, { server, username: res.username ?? username, token: res.token, rev: 0, error: undefined })
    this.store.flush()
    this.emit()
    await this.sync().catch(() => {})
    return this.status()
  }

  async signOut(): Promise<SyncStatus> {
    const { server, token } = this.st
    if (server && token) await this.request(server, '/api/logout', 'POST', token).catch(() => {})
    Object.assign(this.st, { ...fresh(), auto: this.st.auto, settingsHash: this.st.settingsHash })
    this.store.flush()
    this.emit()
    return this.status()
  }

  /** Текущий вход: для запросов профиля к тому же серверу. */
  session(): { server: string; token: string; username: string } | null {
    const { server, token, username } = this.st
    return server && token ? { server, token, username } : null
  }

  /** Запрос к серверу от имени вошедшего пользователя. */
  async api(path: string, method: string, body?: unknown): Promise<any> {
    const s = this.session()
    if (!s) throw new Error('Войдите в аккаунт Wave (Настройки → Аккаунт).')
    try {
      return await this.request(s.server, path, method, s.token, body)
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        this.st.token = ''
        this.st.error = 'Сессия истекла — войдите заново.'
        this.store.save()
        this.emit()
      }
      throw e
    }
  }

  setAuto(auto: boolean): SyncStatus {
    this.st.auto = auto
    this.store.save()
    this.emit()
    return this.status()
  }

  // ───── сеть ─────

  private async request(server: string, path: string, method: string, token?: string, body?: unknown): Promise<any> {
    let res: Response
    try {
      res = await fetch(server + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(25_000)
      })
    } catch (e) {
      throw new Error(`Нет связи с сервером синхронизации (${errMsg(e)}).`)
    }
    const text = await res.text()
    let json: any = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      /* не JSON */
    }
    if (res.status === 409 && path === '/api/sync') return { conflict: true, ...json }
    if (!res.ok) {
      const err = new Error(json.error ?? `Сервер ответил ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    return json
  }

  // ───── документ ─────

  private syncedSettings(): SyncedSettings {
    const s = this.settings.get()
    const { volume: _v, muted: _m, outputDeviceId: _o, ...audio } = s.audio
    const { backgroundImage: _b, ...appearance } = s.appearance
    return { appearance: appearance as Settings['appearance'], audio, customCss: s.extensions.customCss }
  }

  private buildLocal(): SyncDoc {
    const s = this.st
    const tracks: Record<string, RemoteTrack> = {}
    for (const t of this.lib.allTracks()) {
      const key = trackKey(t)
      const prev = tracks[key]
      if (prev && prev.addedAt <= t.addedAt) continue
      tracks[key] = {
        title: t.title,
        artist: t.artist,
        artists: t.artists,
        album: t.album,
        year: t.year,
        duration: t.duration,
        source: t.source.kind === 'local' ? { kind: 'local' } : { ...t.source },
        addedAt: t.addedAt,
        plays: t.plays,
        liked: t.liked,
        likedAt: t.likedAt
      }
    }
    const idToKey = new Map(this.lib.allTracks().map((t) => [t.id, trackKey(t)]))
    const playlists: Record<string, RemotePlaylist> = {}
    for (const p of this.lib.playlists) {
      const keys = p.trackIds.map((id) => idToKey.get(id)).filter((k): k is string => !!k)
      for (const k of s.playlistExtra[p.id] ?? []) if (!keys.includes(k)) keys.push(k)
      playlists[p.id] = { id: p.id, name: p.name, keys, createdAt: p.createdAt, updatedAt: p.updatedAt }
    }
    for (const [id, at] of Object.entries(s.deletedPlaylists)) {
      if (!playlists[id] || playlists[id].updatedAt <= at) playlists[id] = { id, name: '', keys: [], createdAt: at, updatedAt: at, deleted: true }
    }
    return { v: 1, tracks, removed: { ...s.removed }, playlists, settings: { at: s.settingsAt, value: this.syncedSettings() } }
  }

  /** Слияние локального и серверного документов. Не удаляет файлов и не теряет данных ни одной стороны. */
  private merge(local: SyncDoc, remote: SyncDoc | null): SyncDoc {
    if (!remote) return local
    const removed: Record<string, number> = { ...remote.removed }
    for (const [k, v] of Object.entries(local.removed)) removed[k] = Math.max(removed[k] ?? 0, v)

    const tracks: Record<string, RemoteTrack> = {}
    for (const key of new Set([...Object.keys(local.tracks), ...Object.keys(remote.tracks)])) {
      const l = local.tracks[key]
      const r = remote.tracks[key]
      const base = r ?? l
      const latestAdd = Math.max(l?.addedAt ?? 0, r?.addedAt ?? 0)
      if ((removed[key] ?? 0) >= latestAdd) continue
      const lAt = l?.likedAt ?? 0
      const rAt = r?.likedAt ?? 0
      const liked = l && r ? (lAt === rAt ? l.liked || r.liked : lAt > rAt ? l.liked : r.liked) : base.liked
      tracks[key] = {
        ...base,
        addedAt: Math.min(l?.addedAt ?? Infinity, r?.addedAt ?? Infinity),
        plays: Math.max(l?.plays ?? 0, r?.plays ?? 0),
        liked,
        likedAt: Math.max(lAt, rAt) || undefined
      }
      delete removed[key] // трек добавлен заново после удаления
    }
    // tombstone имеет смысл, только пока трека нет в документе
    for (const k of Object.keys(removed)) if (tracks[k]) delete removed[k]

    const playlists: Record<string, RemotePlaylist> = {}
    for (const id of new Set([...Object.keys(local.playlists), ...Object.keys(remote.playlists)])) {
      const l = local.playlists[id]
      const r = remote.playlists[id]
      playlists[id] = l && r ? (l.updatedAt > r.updatedAt ? l : r) : (l ?? r)
    }

    const ls = local.settings
    const rs = remote.settings
    const settings = ls && rs ? (ls.at > rs.at ? ls : rs) : (ls ?? rs)
    return { v: 1, tracks, removed, playlists, settings }
  }

  /** Применяет объединённый документ к библиотеке и настройкам. */
  private apply(doc: SyncDoc): void {
    const s = this.st
    this.applying = true
    try {
      // треки: «любимое» и счётчик
      const keyToId = new Map<string, string>()
      for (const t of this.lib.allTracks()) {
        const key = trackKey(t)
        keyToId.set(key, t.id)
        const m = doc.tracks[key]
        if (!m) continue
        const patch: Partial<Track> = {}
        if (m.liked !== t.liked) patch.liked = m.liked
        if ((m.likedAt ?? 0) !== (t.likedAt ?? 0)) patch.likedAt = m.likedAt
        if (m.plays > t.plays) patch.plays = m.plays
        if (Object.keys(patch).length) this.lib.update(t.id, patch)
      }

      // недостающие треки
      s.pending = {}
      for (const [key, t] of Object.entries(doc.tracks)) if (!keyToId.has(key) && t.source.kind !== 'local') s.pending[key] = t

      // плейлисты
      const localById = new Map(this.lib.playlists.map((p) => [p.id, p]))
      s.playlistExtra = {}
      for (const [id, rp] of Object.entries(doc.playlists)) {
        const cur = localById.get(id)
        if (rp.deleted) {
          // слияние выбирает запись с большим updatedAt, так что удаление здесь заведомо новее локального плейлиста
          if (cur) this.lib.dropPlaylistRaw(id)
          s.deletedPlaylists[id] = rp.updatedAt
          continue
        }
        delete s.deletedPlaylists[id]
        const ids: string[] = []
        const extra: string[] = []
        for (const k of rp.keys) {
          const tid = keyToId.get(k)
          if (tid) {
            if (!ids.includes(tid)) ids.push(tid)
          } else extra.push(k)
        }
        if (extra.length) s.playlistExtra[id] = extra
        const next: Playlist = { id, name: rp.name, trackIds: ids, createdAt: rp.createdAt, updatedAt: rp.updatedAt }
        if (!cur || cur.name !== next.name || cur.updatedAt !== next.updatedAt || canon(cur.trackIds) !== canon(ids)) this.lib.upsertPlaylistRaw(next)
      }

      s.removed = doc.removed

      // настройки
      if (doc.settings && doc.settings.at > s.settingsAt) {
        const v = doc.settings.value
        const patch: DeepPartial<Settings> = { appearance: { ...v.appearance }, audio: { ...v.audio }, extensions: { customCss: v.customCss } }
        // фоновое изображение — локальный файл: если у нас его нет, не переключаемся на него
        if (v.appearance.background === 'image') delete (patch.appearance as Record<string, unknown>).background
        this.settings.patch(patch)
        s.settingsAt = doc.settings.at
        s.settingsHash = canon(this.syncedSettings())
      }
    } finally {
      this.applying = false
    }
  }

  // ───── синхронизация ─────

  async sync(): Promise<SyncStatus> {
    if (!this.st.token) throw new Error('Войдите в аккаунт.')
    if (this.syncing) return this.status()
    this.syncing = true
    this.st.error = undefined
    this.emit()
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { server, token } = this.st
        const remote = await this.request(server, '/api/sync', 'GET', token)
        const remoteDoc = normalizeDoc(remote.data)
        const merged = this.merge(this.buildLocal(), remoteDoc)
        this.apply(merged)
        if (remoteDoc && canon(merged) === canon(remoteDoc)) {
          this.st.rev = remote.rev
          break
        }
        const put = await this.request(server, '/api/sync', 'PUT', token, { baseRev: remote.rev, data: merged })
        if (put.conflict) continue // кто-то успел раньше — повторим с свежими данными
        this.st.rev = put.rev
        break
      }
      this.st.lastSync = Date.now()
    } catch (e) {
      const err = e as Error & { status?: number }
      this.st.error = err.status === 401 ? 'Сессия истекла — войдите заново.' : errMsg(e)
      if (err.status === 401) this.st.token = ''
      throw e
    } finally {
      this.syncing = false
      this.store.save()
      this.emit()
    }
    return this.status()
  }

  /** Ставит в очередь загрузку всех недостающих треков (по их источнику). */
  downloadMissing(): number {
    const items: ImportItem[] = Object.entries(this.st.pending).map(([key, t]) => {
      const src = t.source
      let fetch: ImportItem['fetch']
      if (src.matchedUrl) fetch = { type: 'url', url: src.matchedUrl }
      else if ((src.kind === 'youtube' || src.kind === 'soundcloud' || src.kind === 'other') && src.url) fetch = { type: 'url', url: src.url }
      else if (src.kind === 'yandex' && src.id) fetch = { type: 'yandex', trackId: src.id }
      else fetch = { type: 'search', query: `${t.artists.slice(0, 2).join(' ')} ${t.title}`.trim() }
      return { key: `sync:${key}`, title: t.title, artists: t.artists.length ? t.artists : [t.artist], album: t.album, year: t.year, duration: t.duration, source: src, fetch }
    })
    return items.length ? this.enqueue(items) : 0
  }
}
