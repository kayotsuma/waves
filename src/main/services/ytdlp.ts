import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Settings } from '@shared/types'
import type { Binaries } from './binaries'
import { AUDIO_EXTS } from './probe'

export interface Candidate {
  id: string
  url: string
  title: string
  duration?: number
  channel?: string
  thumbnail?: string
}

export interface ProgressInfo {
  percent: number
  speed?: number
  eta?: number
}

export class YtDlpError extends Error {
  constructor(
    message: string,
    public raw = ''
  ) {
    super(message)
  }
}

/** Превращает вывод yt-dlp в человеческое сообщение. */
export function friendlyError(stderr: string): string {
  const lines = stderr.split('\n').filter((l) => /ERROR/i.test(l))
  const last = (lines.pop() ?? stderr.trim().split('\n').pop() ?? '').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/i, '').trim()
  const t = stderr.toLowerCase()
  if (t.includes('sign in to confirm') || t.includes('not a bot'))
    return 'YouTube просит подтвердить, что вы не бот. Включите «Куки из браузера» в Настройки → Загрузка.'
  if (t.includes('private video') || t.includes('members-only')) return 'Видео приватное или только для подписчиков.'
  if (t.includes('video unavailable') || t.includes('this video is not available')) return 'Видео недоступно.'
  if (t.includes('http error 429') || t.includes('too many requests')) return 'Слишком много запросов (429). Подождите немного.'
  if (t.includes('http error 403')) return 'Доступ запрещён (403). Попробуйте обновить yt-dlp или включить куки браузера.'
  if (t.includes('requested format is not available')) return 'Не найден подходящий аудиоформат.'
  if (t.includes('unable to download') || t.includes('urlopen error') || t.includes('timed out'))
    return 'Сетевая ошибка при обращении к источнику.'
  if (t.includes('no js runtime') || t.includes('javascript runtime')) return 'Для YouTube нужен JS-рантайм (Node/Deno) — см. Настройки → О программе.'
  return last || 'Неизвестная ошибка yt-dlp'
}

export class YtDlp {
  constructor(
    private bins: Binaries,
    private getSettings: () => Settings
  ) {}

  private common(): { args: string[]; env: NodeJS.ProcessEnv } {
    const s = this.getSettings().download
    const rt = this.bins.jsRuntime()
    const args = ['--no-warnings', '--ignore-config', '--js-runtimes', rt.arg]
    const ff = this.bins.ffmpegPath
    if (ff) args.push('--ffmpeg-location', ff)
    if (s.cookiesFromBrowser && s.cookiesFromBrowser !== 'none') args.push('--cookies-from-browser', s.cookiesFromBrowser)
    if (s.proxy.trim()) args.push('--proxy', s.proxy.trim())
    return { args, env: rt.env }
  }

  private exec(args: string[], signal?: AbortSignal, onStdoutLine?: (l: string) => void): Promise<{ stdout: string; stderr: string }> {
    const st = this.bins.getStatus().ytdlp
    if (st.state !== 'ready') return Promise.reject(new YtDlpError('yt-dlp ещё не готов. Подождите завершения установки или проверьте Настройки.'))
    const { args: common, env } = this.common()
    return new Promise((resolve, reject) => {
      const p = spawn(this.bins.ytdlpPath, [...common, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env, PYTHONUNBUFFERED: '1' }
      })
      let stdout = ''
      let stderr = ''
      let buf = ''
      p.stdout.on('data', (d: Buffer) => {
        const s = d.toString()
        stdout += s
        if (onStdoutLine) {
          buf += s
          let i: number
          while ((i = buf.indexOf('\n')) >= 0) {
            onStdoutLine(buf.slice(0, i))
            buf = buf.slice(i + 1)
          }
        }
      })
      p.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
      p.on('error', (e) => reject(new YtDlpError(`Не удалось запустить yt-dlp: ${e.message}`)))
      const onAbort = () => p.kill('SIGTERM')
      signal?.addEventListener('abort', onAbort, { once: true })
      p.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) return reject(new YtDlpError('Отменено'))
        if (code === 0) resolve({ stdout, stderr })
        else reject(new YtDlpError(friendlyError(stderr), stderr))
      })
    })
  }

  async json(target: string, extra: string[] = [], signal?: AbortSignal): Promise<any> {
    const { stdout } = await this.exec(['-J', ...extra, '--', target], signal)
    return JSON.parse(stdout)
  }

  /** Метаданные ссылки: одно видео или плейлист (без скачивания). */
  async info(url: string, opts: { playlist: boolean; end?: number; signal?: AbortSignal }): Promise<any> {
    const extra = opts.playlist ? ['--flat-playlist', '--yes-playlist', '--playlist-end', String(opts.end ?? 300)] : ['--no-playlist']
    return this.json(url, extra, opts.signal)
  }

  /** Прямая ссылка на аудиопоток (без скачивания) и заголовки, которые к ней нужно слать. */
  async streamInfo(url: string, signal?: AbortSignal): Promise<{ url: string; headers: Record<string, string>; hls: boolean }> {
    const j = await this.json(
      url,
      ['--no-playlist', '-f', 'bestaudio[protocol^=http][protocol!*=m3u8][protocol!*=dash]/bestaudio[protocol^=http][protocol!*=m3u8]/bestaudio'],
      signal
    )
    const direct = typeof j.url === 'string' ? j : Array.isArray(j.requested_formats) ? j.requested_formats[0] : null
    if (!direct?.url) throw new Error('Источник не отдал прямую ссылку на звук.')
    const hls = /m3u8/i.test(String(direct.protocol ?? '')) || /\.m3u8(\?|$)/.test(direct.url)
    if (!hls && /dash/i.test(String(direct.protocol ?? ''))) throw new Error('Этот источник отдаёт звук в формате DASH — потоковое воспроизведение недоступно, скачайте трек.')
    return { url: direct.url, headers: { ...(direct.http_headers ?? j.http_headers ?? {}) }, hls }
  }

  private toCandidates(j: any): Candidate[] {
    const entries: any[] = Array.isArray(j?.entries) ? j.entries : []
    return entries
      .filter((e) => e && (e.id || e.url))
      .map((e) => {
        const id = String(e.id ?? '')
        const url: string =
          e.url && /^https?:/.test(e.url) ? e.url : e.webpage_url || (id ? `https://www.youtube.com/watch?v=${id}` : '')
        return {
          id,
          url,
          title: String(e.title ?? ''),
          duration: typeof e.duration === 'number' ? e.duration : undefined,
          channel: e.channel || e.uploader || undefined,
          thumbnail: e.thumbnails?.[e.thumbnails.length - 1]?.url
        } as Candidate
      })
      .filter((c) => c.url)
  }

  async searchYouTube(query: string, n = 8, signal?: AbortSignal): Promise<Candidate[]> {
    const j = await this.json(`ytsearch${n}:${query}`, ['--flat-playlist'], signal)
    return this.toCandidates(j)
  }

  /** Поиск именно по YouTube Music (песни, чистое аудио). */
  async searchYouTubeMusic(query: string, signal?: AbortSignal): Promise<Candidate[]> {
    const j = await this.json(`https://music.youtube.com/search?q=${encodeURIComponent(query)}`, ['--flat-playlist', '--playlist-end', '8'], signal)
    return this.toCandidates(j)
  }

  /**
   * Скачивает лучшее аудио без перекодирования.
   * Результат — файл audio.<ext> в dir, а также audio.info.json и audio.jpg (если есть).
   */
  async download(
    url: string,
    dir: string,
    onProgress: (p: ProgressInfo) => void,
    onStage: (stage: 'download' | 'extract') => void,
    signal?: AbortSignal
  ): Promise<{ audioFile: string; thumbFile?: string; info: any }> {
    const args = [
      '--no-playlist',
      '-f',
      'bestaudio/best',
      // сначала самый высокий битрейт, потом предпочтение кодеков (opus > aac > mp3)
      '-S',
      'abr,acodec',
      '-x',
      '--audio-quality',
      '0',
      '--write-info-json',
      '--write-thumbnail',
      '--convert-thumbnails',
      'jpg',
      '--concurrent-fragments',
      '4',
      '--retries',
      '5',
      '--fragment-retries',
      '5',
      '--no-mtime',
      '--newline',
      '--progress-template',
      'download:[wave] %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
      '-o',
      join(dir, 'audio.%(ext)s'),
      '--',
      url
    ]
    onStage('download')
    await this.exec(args, signal, (line) => {
      if (line.startsWith('[wave]')) {
        const [dl, total, est, speed, eta] = line.slice(6).trim().split(/\s+/).map((x) => (x === 'None' || x === 'NA' ? NaN : Number(x)))
        const tot = Number.isFinite(total) ? total : est
        if (Number.isFinite(dl) && Number.isFinite(tot) && tot > 0) {
          onProgress({
            percent: Math.min(100, (dl / tot) * 100),
            speed: Number.isFinite(speed) ? speed : undefined,
            eta: Number.isFinite(eta) ? eta : undefined
          })
        }
      } else if (line.startsWith('[ExtractAudio]')) {
        onStage('extract')
      }
    })

    const files = readdirSync(dir)
    const audio = files.find((f) => f.startsWith('audio.') && AUDIO_EXTS.has(extname(f).toLowerCase()) && !f.endsWith('.part'))
    if (!audio) throw new YtDlpError('yt-dlp не создал аудиофайл')
    const thumb = files.find((f) => f === 'audio.jpg')
    let info: any = {}
    const infoPath = join(dir, 'audio.info.json')
    if (existsSync(infoPath)) {
      try {
        info = JSON.parse(readFileSync(infoPath, 'utf8'))
      } catch {
        /* ignore */
      }
    }
    return { audioFile: join(dir, audio), thumbFile: thumb ? join(dir, thumb) : undefined, info }
  }
}
