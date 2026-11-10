import type { ImportItem, ImportPreview, SourceKind } from '@shared/types'
import { isHttpUrl } from '../util'
import type { LibraryService } from '../library'
import { parseEntry, resolveViaYtDlp } from './sources/generic'
import { isAppleMusicUrl, resolveApple } from './sources/apple'
import { isDeezerUrl, resolveDeezer } from './sources/deezer'
import { resolveSpotify } from './sources/spotify'
import { YandexClient, isYandexUrl } from './sources/yandex'
import type { Candidate, YtDlp } from './ytdlp'

export function detectSource(input: string): SourceKind | null {
  if (/^spotify:(track|album|playlist):/.test(input)) return 'spotify'
  if (!isHttpUrl(input)) return null
  const host = new URL(input).hostname.replace(/^www\./, '').replace(/^m\./, '')
  if (/(^|\.)youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/.test(host)) return 'youtube'
  if (/(^|\.)soundcloud\.com$|^snd\.sc$/.test(host)) return 'soundcloud'
  if (host === 'open.spotify.com' || host === 'spotify.link') return 'spotify'
  if (isAppleMusicUrl(input)) return 'apple'
  if (isDeezerUrl(input)) return 'deezer'
  if (isYandexUrl(input)) return 'yandex'
  return 'other'
}

export class Resolver {
  constructor(
    private yt: YtDlp,
    private lib: LibraryService,
    private getYandexToken: () => string
  ) {}

  /** Принимает ссылку или поисковый запрос. */
  async resolve(raw: string): Promise<ImportPreview> {
    const input = raw.trim()
    if (!input) throw new Error('Пустой ввод.')
    const kind = detectSource(input)
    let preview: ImportPreview

    if (!kind) preview = await this.search(input)
    else if (kind === 'spotify') preview = await resolveSpotify(input)
    else if (kind === 'apple') preview = await resolveApple(input)
    else if (kind === 'deezer') preview = await resolveDeezer(input)
    else if (kind === 'yandex') preview = await new YandexClient(this.getYandexToken()).resolve(input)
    else preview = await resolveViaYtDlp(input, kind, this.yt)

    for (const it of preview.items) it.inLibrary = this.isKnown(it)
    return preview
  }

  private isKnown(it: ImportItem): boolean {
    return !!(it.source.id && this.lib.findBySource(it.source.kind, it.source.id))
  }

  private async search(query: string): Promise<ImportPreview> {
    let candidates: Candidate[] = []
    try {
      candidates = await this.yt.searchYouTubeMusic(query)
    } catch {
      /* упадём в обычный поиск */
    }
    if (!candidates.length) candidates = await this.yt.searchYouTube(query, 12)
    const items = candidates
      .map((c) =>
        parseEntry(
          { id: c.id, title: c.title, channel: c.channel, duration: c.duration, webpage_url: c.url, thumbnails: c.thumbnail ? [{ url: c.thumbnail }] : [] },
          'youtube'
        )
      )
      .filter(Boolean) as ImportItem[]
    return {
      sourceKind: 'youtube',
      url: query,
      kind: 'playlist',
      title: `Поиск: ${query}`,
      subtitle: `${items.length} результатов`,
      coverUrl: items[0]?.coverUrl,
      items,
      notes: []
    }
  }
}
