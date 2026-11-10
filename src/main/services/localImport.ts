import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Track } from '@shared/types'
import type { LibraryService } from '../library'
import { coversDir, tmpDir } from '../paths'
import { sanitizeFilename, splitArtists } from '../util'
import type { Binaries } from './binaries'
import { audioCodec, audioTarget, extractAudio, measureLoudness, squareCover, videoFrame } from './ffmpeg'
import { AUDIO_EXTS, VIDEO_EXTS, probeAudio } from './probe'

function collect(path: string, out: string[], depth = 0): void {
  let st
  try {
    st = statSync(path)
  } catch {
    return
  }
  if (st.isDirectory()) {
    if (depth > 6) return
    for (const name of readdirSync(path)) if (!name.startsWith('.')) collect(join(path, name), out, depth + 1)
  } else {
    const ext = extname(path).toLowerCase()
    if (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) out.push(path)
  }
}

export function uniquePath(dir: string, base: string, ext: string): string {
  let p = join(dir, `${base}.${ext}`)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${base} (${i}).${ext}`)
  return p
}

/**
 * Видео → аудиофайл в папке музыки (исходное видео не трогаем).
 * Возвращает путь к аудио и, если получилось, кадр для обложки.
 */
async function extractFromVideo(ffmpeg: string, video: string, musicDir: string, id: string): Promise<{ file: string; frame?: string } | null> {
  const codec = await audioCodec(ffmpeg, video)
  if (!codec) return null
  const { ext, args } = audioTarget(codec)
  mkdirSync(musicDir, { recursive: true })
  const out = uniquePath(musicDir, sanitizeFilename(basename(video, extname(video))), ext)
  if (!(await extractAudio(ffmpeg, video, out, args))) {
    rmSync(out, { force: true })
    return null
  }
  const frame = join(tmpDir(), `${id}.frame.jpg`)
  const ok = (await videoFrame(ffmpeg, video, frame, 1)) || (await videoFrame(ffmpeg, video, frame, 0))
  return { file: out, frame: ok ? frame : undefined }
}

/** Добавляет в библиотеку уже существующие файлы (без копирования). */
export async function importLocalFiles(paths: string[], lib: LibraryService, bins: Binaries, musicDir: string): Promise<Track[]> {
  const files: string[] = []
  for (const p of paths) collect(p, files)
  const added: Track[] = []
  const ffmpeg = bins.ffmpegPath

  for (const original of files) {
    if (lib.findByFile(original) || lib.findBySourceUrl(original)) continue
    let file = original
    let frame: string | undefined
    const isVideo = VIDEO_EXTS.has(extname(original).toLowerCase())
    try {
      const id = randomUUID()
      if (isVideo) {
        if (!ffmpeg) throw new Error('ffmpeg ещё не готов')
        const ex = await extractFromVideo(ffmpeg, original, musicDir, id)
        if (!ex) {
          console.warn('[local] в видео нет звука или не удалось извлечь', original)
          continue
        }
        file = ex.file
        frame = ex.frame
      }
      const pr = await probeAudio(file, true)
      const name = basename(original, extname(original))
      const m = name.match(/^(.+?)\s+-\s+(.+)$/)
      const title = pr.title || (m ? m[2] : name)
      const artists = pr.artists?.length ? pr.artists : m ? splitArtists(m[1]) : ['Unknown Artist']

      let hasCover = false
      if (pr.cover && ffmpeg) {
        const raw = join(tmpDir(), `${id}.cover`)
        try {
          writeFileSync(raw, pr.cover)
          hasCover = await squareCover(ffmpeg, raw, join(coversDir(), `${id}.jpg`))
        } finally {
          rmSync(raw, { force: true })
        }
      }
      if (!hasCover && frame && ffmpeg) {
        hasCover = await squareCover(ffmpeg, frame, join(coversDir(), `${id}.jpg`))
      }
      if (frame) rmSync(frame, { force: true })
      const loud = ffmpeg ? await measureLoudness(ffmpeg, file).catch(() => ({}) as { loudness?: number; peak?: number }) : {}
      added.push(
        lib.add({
          id,
          title,
          artist: artists.join(', '),
          artists,
          album: pr.album,
          year: pr.year,
          duration: pr.duration,
          file,
          hasCover,
          size: pr.size,
          codec: pr.codec,
          bitrate: pr.bitrate,
          sampleRate: pr.sampleRate,
          bitDepth: pr.bitDepth,
          lossless: pr.lossless,
          loudness: (loud as any).loudness,
          peak: (loud as any).peak,
          source: isVideo ? { kind: 'local', url: original } : { kind: 'local' }
        })
      )
    } catch (e) {
      console.warn('[local] пропущен файл', original, e)
    }
  }
  return added
}

export function replaceCover(ffmpeg: string, trackId: string, imagePath: string): Promise<boolean> {
  return squareCover(ffmpeg, imagePath, join(coversDir(), `${trackId}.jpg`))
}
