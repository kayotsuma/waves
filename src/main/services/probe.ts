import { statSync } from 'node:fs'
import { extname } from 'node:path'
import type { Track } from '@shared/types'

type Probed = Pick<Track, 'duration' | 'size' | 'codec' | 'bitrate' | 'sampleRate' | 'bitDepth' | 'lossless'> & {
  title?: string
  artists?: string[]
  album?: string
  year?: number
  cover?: Uint8Array
}

function codecName(codec: string | undefined, ext: string): string | undefined {
  const c = (codec ?? '').toLowerCase()
  if (c.includes('opus')) return 'opus'
  if (c.includes('vorbis')) return 'vorbis'
  if (c.includes('flac')) return 'flac'
  if (c.includes('alac')) return 'alac'
  if (c.includes('mpeg') && c.includes('layer 3')) return 'mp3'
  if (c.includes('mp3')) return 'mp3'
  if (c.includes('aac') || c.includes('mpeg-4') || c.includes('mp4a')) return 'aac'
  if (c.includes('pcm')) return 'pcm'
  return c ? c : ext.replace('.', '') || undefined
}

/** Читает технические параметры и теги аудиофайла. */
export async function probeAudio(file: string, withCover = false): Promise<Probed> {
  const { parseFile, selectCover } = await import('music-metadata')
  const ext = extname(file).toLowerCase()
  const size = statSync(file).size
  const md = await parseFile(file, { duration: true, skipCovers: !withCover })
  const f = md.format
  const duration = f.duration ?? 0
  const bitrate = f.bitrate ?? (duration > 0 ? (size * 8) / duration : undefined)
  const cover = withCover ? selectCover(md.common.picture) : null
  return {
    duration,
    size,
    codec: codecName(f.codec, ext),
    bitrate: bitrate ? Math.round(bitrate / 1000) : undefined,
    sampleRate: f.sampleRate,
    bitDepth: f.bitsPerSample,
    lossless: f.lossless ?? ['.flac', '.wav', '.alac', '.aiff'].includes(ext),
    title: md.common.title,
    artists: md.common.artists?.length ? md.common.artists : md.common.artist ? [md.common.artist] : undefined,
    album: md.common.album,
    year: md.common.year,
    cover: cover?.data
  }
}

export const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav', '.webm', '.mka', '.oga', '.aiff', '.alac'])

/** Видеофайлы: из них Wave вытаскивает звук (без перекодирования, если возможно). */
export const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.avi', '.flv', '.wmv', '.3gp', '.mpg', '.mpeg'])
