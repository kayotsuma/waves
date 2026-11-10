import { readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { nativeImage } from 'electron'
import { defaultProfile, MAX_IMAGE, sanitizeListItem, sanitizeProfile, sanitizePublic, sanitizeResolved } from '@shared/profile'
import type { PublishState } from '@shared/api'
import type { Profile, ProfileListItem, PublicProfile, ResolvedBlock, ShowcaseData } from '@shared/types'
import type { LibraryService } from '../library'
import { coversDir, dataDir } from '../paths'
import { JsonStore } from '../store'
import type { SyncService } from './sync'


const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

/**
 * Профиль пользователя и его витрина. Хранится локально (profile.json) и работает без аккаунта;
 * если выполнен вход на сервер синхронизации и включено «Показывать другим», витрина публикуется там же.
 * На сервер уходят уже «развёрнутые» данные: названия и маленькие обложки — но не файлы и не пути.
 */
export class ProfileService {
  private store: JsonStore<{ profile: Profile; publishedAt: number }>
  private thumbs = new Map<string, string>()
  private state: PublishState = { published: false }
  onChange: (p: Profile) => void = () => {}

  constructor(
    private lib: LibraryService,
    private sync: SyncService
  ) {
    this.store = new JsonStore(join(dataDir(), 'profile.json'), { profile: defaultProfile(), publishedAt: 0 }, (l) => {
      const o = l as { profile?: unknown; publishedAt?: number }
      return { profile: o?.profile ? sanitizeProfile(o.profile) : defaultProfile(), publishedAt: Number(o?.publishedAt) || 0 }
    })
    this.state = { published: this.store.data.publishedAt > 0, at: this.store.data.publishedAt || undefined }
  }

  get(): Profile {
    return this.store.data.profile
  }

  set(raw: unknown): Profile {
    const p = sanitizeProfile(raw)
    p.updatedAt = Date.now()
    this.store.data.profile = p
    this.store.save()
    this.onChange(p)
    return p
  }

  publishState(): PublishState {
    return { ...this.state, published: this.state.published && !!this.sync.session() }
  }

  /** Картинка для аватара или баннера → data:-URL. Большие уменьшаются; GIF остаётся как есть (анимация). */
  loadImage(file: string, kind: 'avatar' | 'banner'): string {
    const ext = extname(file).toLowerCase()
    const mime = MIME[ext]
    if (!mime) throw new Error('Нужна картинка: jpg, png, webp или gif')
    const size = statSync(file).size
    if (ext !== '.gif') {
      const img = nativeImage.createFromPath(file)
      if (!img.isEmpty()) {
        const { width, height } = img.getSize()
        const target = kind === 'avatar' ? 420 : 1600
        const scaled =
          kind === 'avatar'
            ? Math.min(width, height) > target
              ? img.resize(width < height ? { width: target, quality: 'best' } : { height: target, quality: 'best' })
              : img
            : width > target
              ? img.resize({ width: target, quality: 'best' })
              : img
        const out = scaled.toJPEG(88)
        if (out.length * 1.37 < MAX_IMAGE) return `data:image/jpeg;base64,${out.toString('base64')}`
      }
    }
    // GIF (и то, что не смог открыть nativeImage) — без изменений, если влезает
    if (size * 1.37 > MAX_IMAGE) throw new Error(`Файл слишком большой: до ${Math.floor(MAX_IMAGE / 1.37 / 1_000_000 * 10) / 10} МБ`)
    return `data:${mime};base64,${readFileSync(file).toString('base64')}`
  }

  /** Маленькая обложка трека для публикации. */
  private thumb(trackId: string, width = 160): string | undefined {
    const t = this.lib.get(trackId)
    if (!t?.hasCover) return undefined
    const key = `${trackId}:${t.coverRev}:${width}`
    const hit = this.thumbs.get(key)
    if (hit) return hit
    const img = nativeImage.createFromPath(join(coversDir(), `${trackId}.jpg`))
    if (img.isEmpty()) return undefined
    const { width: w } = img.getSize()
    const url = `data:image/jpeg;base64,${(w > width ? img.resize({ width, quality: 'good' }) : img).toJPEG(80).toString('base64')}`
    if (this.thumbs.size > 400) this.thumbs.clear()
    this.thumbs.set(key, url)
    return url
  }

  private publicCover(ref: string | undefined): string | undefined {
    const m = ref && /^wave:\/\/cover\/([\w.-]+)/.exec(ref)
    return m ? this.thumb(m[1]) : ref
  }

  /** Витрину с локальными ссылками на обложки превращает в самодостаточную: обложки — маленькие data:-картинки. */
  private toPublic(data: ShowcaseData): { resolved: Record<string, ResolvedBlock>; bannerCover?: string } {
    const resolved: Record<string, ResolvedBlock> = {}
    for (const [id, raw] of Object.entries(data.resolved ?? {})) {
      const r = sanitizeResolved(raw, true)
      const fix = <T extends { cover?: string; trackId?: string; key?: string }>(i: T): T => ({ ...i, cover: this.publicCover(i.cover), trackId: undefined, key: undefined })
      if (r.items) r.items = r.items.map(fix)
      if (r.quoteBy) r.quoteBy = fix(r.quoteBy)
      if (r.nowPlaying) r.nowPlaying = fix(r.nowPlaying)
      if (r.year) r.year = { ...r.year, topTrack: r.year.topTrack && fix(r.year.topTrack), topArtist: r.year.topArtist && fix(r.year.topArtist) }
      if (r.playlist) r.playlist = { ...r.playlist, covers: r.playlist.covers.map((c) => this.publicCover(c)).filter((c): c is string => !!c) }
      resolved[id] = r
    }
    const p = this.get()
    const bannerCover = p.banner.kind === 'cover' && p.banner.trackId ? this.thumb(p.banner.trackId, 900) : undefined
    return { resolved, bannerCover }
  }

  private avatarThumb(): string | undefined {
    const a = this.get().avatar
    if (!a) return undefined
    const img = nativeImage.createFromDataURL(a)
    if (img.isEmpty()) return undefined
    const { width, height } = img.getSize()
    const small = Math.min(width, height) > 96 ? img.resize(width < height ? { width: 96 } : { height: 96 }) : img
    return `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`
  }

  /** Опубликовать (или снять с публикации) витрину на сервере синхронизации. */
  async publish(data: ShowcaseData): Promise<PublishState> {
    const p = this.get()
    if (!this.sync.session()) {
      this.state = { published: false, error: undefined }
      return this.state
    }
    try {
      if (!p.publish) {
        if (this.store.data.publishedAt) await this.sync.api('/api/profile', 'DELETE')
        this.store.data.publishedAt = 0
        this.store.save()
        this.state = { published: false }
        return this.state
      }
      const pub = this.toPublic(data)
      await this.sync.api('/api/profile', 'PUT', { profile: p, ...pub, thumb: this.avatarThumb() })
      const at = Date.now()
      this.store.data.publishedAt = at
      this.store.save()
      this.state = { published: true, at }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.state = { ...this.state, error: /404/.test(msg) || /Не найдено/.test(msg) ? 'Сервер устарел: обновите server/server.mjs, чтобы публиковать витрину.' : msg }
    }
    return this.state
  }

  async list(): Promise<ProfileListItem[]> {
    const r = await this.sync.api('/api/profiles', 'GET')
    return (Array.isArray(r?.profiles) ? r.profiles : []).map(sanitizeListItem).filter((x: ProfileListItem | null): x is ProfileListItem => !!x)
  }

  async fetch(username: string): Promise<PublicProfile> {
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error('Некорректное имя пользователя')
    const r = await this.sync.api(`/api/profile/${encodeURIComponent(username)}`, 'GET')
    const p = sanitizePublic(r)
    if (!p) throw new Error('Профиль повреждён')
    return p
  }

  flush(): void {
    this.store.flush()
  }
}
