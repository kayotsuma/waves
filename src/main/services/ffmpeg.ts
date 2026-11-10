import { spawn } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export function run(bin: string, args: string[], opts: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...opts.env } })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('error', reject)
    const onAbort = () => p.kill('SIGKILL')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    p.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

const COMMON = ['-nostdin', '-hide_banner', '-y']

/** Интегральная громкость (EBU R128) и true-peak. */
export async function measureLoudness(ffmpeg: string, file: string): Promise<{ loudness?: number; peak?: number }> {
  const r = await run(ffmpeg, ['-nostdin', '-hide_banner', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'])
  const i = [...r.stderr.matchAll(/\bI:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)].pop()
  const p = [...r.stderr.matchAll(/\bPeak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/g)].pop()
  const loudness = i ? Number(i[1]) : undefined
  const peak = p ? Number(p[1]) : undefined
  return {
    loudness: loudness !== undefined && Number.isFinite(loudness) && loudness > -70 ? loudness : undefined,
    peak: peak !== undefined && Number.isFinite(peak) ? peak : undefined
  }
}

/** Декодирует звук в моно s16le на заданной частоте (для анализа). null — если не получилось. */
export function decodePcm(ffmpeg: string, file: string, sampleRate: number, maxSeconds: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const p = spawn(
      ffmpeg,
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate), '-t', String(maxSeconds), '-f', 's16le', '-'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', () => resolve(null))
    p.on('close', (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null))
  })
}

/** Приводит любую картинку к квадрату ≤1000px (обрезка по центру) JPEG. */
export async function squareCover(ffmpeg: string, input: string, output: string): Promise<boolean> {
  const r = await run(ffmpeg, [
    ...COMMON,
    '-i',
    input,
    '-vf',
    "crop='min(iw,ih)':'min(iw,ih)',scale='min(1000,iw)':-2",
    '-frames:v',
    '1',
    '-q:v',
    '2',
    output
  ])
  return r.code === 0
}

export interface Tags {
  title: string
  artist: string
  album?: string
  year?: number
}

const COVER_OK = new Set(['m4a', 'mp4', 'mp3', 'flac'])

/** Записывает теги (и обложку, где контейнер позволяет) без перекодирования звука. */
export async function writeTags(
  ffmpeg: string,
  input: string,
  output: string,
  ext: string,
  tags: Tags,
  coverPath?: string
): Promise<boolean> {
  const meta: string[] = ['-metadata', `title=${tags.title}`, '-metadata', `artist=${tags.artist}`]
  if (tags.album) meta.push('-metadata', `album=${tags.album}`)
  if (tags.year) meta.push('-metadata', `date=${tags.year}`)

  const withCover = coverPath && COVER_OK.has(ext)
  const args = withCover
    ? [
        ...COMMON,
        '-i',
        input,
        '-i',
        coverPath!,
        '-map',
        '0:a:0',
        '-map',
        '1:v:0',
        '-c',
        'copy',
        '-disposition:v:0',
        'attached_pic',
        ...(ext === 'mp3' ? ['-id3v2_version', '3'] : []),
        '-map_metadata',
        '-1',
        ...meta,
        output
      ]
    : [...COMMON, '-i', input, '-map', '0:a:0', '-c', 'copy', '-map_metadata', '-1', ...meta, output]
  const r = await run(ffmpeg, args)
  return r.code === 0
}

/**
 * Вырезает фрагмент [start, end] секунд без перекодирования (звук копируется как есть).
 * Границы привязываются к кадрам кодека (≈20–30 мс), поэтому «ровно по миллисекунде» не гарантируется.
 */
export async function trimAudio(ffmpeg: string, input: string, output: string, ext: string, start: number, end: number): Promise<boolean> {
  const withCover = COVER_OK.has(ext)
  const r = await run(ffmpeg, [
    ...COMMON,
    '-i', input,
    '-ss', start.toFixed(3),
    '-to', end.toFixed(3),
    '-map', '0:a:0',
    ...(withCover ? ['-map', '0:v?', '-disposition:v:0', 'attached_pic'] : []),
    '-c', 'copy',
    '-map_metadata', '0',
    ...(ext === 'mp3' ? ['-id3v2_version', '3'] : []),
    output
  ])
  return r.code === 0
}

/** Кодек первого аудиопотока ('aac', 'opus', ...) или null, если звука нет. */
export async function audioCodec(ffmpeg: string, file: string): Promise<string | null> {
  const r = await run(ffmpeg, ['-nostdin', '-hide_banner', '-i', file])
  const m = r.stderr.match(/Stream #\d+:\d+[^\n]*?: Audio: ([a-z0-9_]+)/i)
  return m ? m[1].toLowerCase() : null
}

/** Контейнер и параметры звука для «вытаскивания» дорожки из видео. Lossy-звук копируется как есть. */
export function audioTarget(codec: string): { ext: string; args: string[] } {
  switch (codec) {
    case 'aac':
      return { ext: 'm4a', args: ['-c:a', 'copy'] }
    case 'opus':
      return { ext: 'opus', args: ['-c:a', 'copy'] }
    case 'vorbis':
      return { ext: 'ogg', args: ['-c:a', 'copy'] }
    case 'mp3':
      return { ext: 'mp3', args: ['-c:a', 'copy'] }
    case 'flac':
      return { ext: 'flac', args: ['-c:a', 'copy'] }
    case 'alac':
      return { ext: 'm4a', args: ['-c:a', 'copy'] }
    default:
      // pcm_* — без потерь во FLAC; остальное (ac3, wma…) — AAC 256k
      return codec.startsWith('pcm_') ? { ext: 'flac', args: ['-c:a', 'flac'] } : { ext: 'm4a', args: ['-c:a', 'aac', '-b:a', '256k'] }
  }
}

/** Вытаскивает аудиодорожку из видео. */
export async function extractAudio(ffmpeg: string, video: string, output: string, args: string[]): Promise<boolean> {
  const r = await run(ffmpeg, [...COMMON, '-i', video, '-vn', '-map', '0:a:0', ...args, '-map_metadata', '0', output])
  return r.code === 0
}

/** Кадр из видео на секунде `at` — используется как обложка. */
export async function videoFrame(ffmpeg: string, video: string, output: string, at = 1): Promise<boolean> {
  const r = await run(ffmpeg, [...COMMON, '-ss', String(at), '-i', video, '-frames:v', '1', '-q:v', '2', output])
  return r.code === 0
}
