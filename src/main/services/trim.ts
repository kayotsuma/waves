import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Track } from '@shared/types'
import type { LibraryService } from '../library'
import { coversDir } from '../paths'
import { sanitizeFilename } from '../util'
import type { Binaries } from './binaries'
import { trimAudio } from './ffmpeg'
import { importLocalFiles, uniquePath } from './localImport'

// Идея «вырезать фрагмент без потерь» — по мотивам встроенного аудиоредактора Riff (rootscripts/riff, MIT),
// реализация своя (ffmpeg -c copy) — см. THIRD_PARTY_NOTICES.md.

const stamp = (s: number) => `${Math.floor(s / 60)}-${String(Math.floor(s % 60)).padStart(2, '0')}`
const label = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Сохраняет фрагмент трека как новый трек в папке музыки. Исходный файл не меняется. */
export async function trimTrack(lib: LibraryService, bins: Binaries, musicDir: string, id: string, start: number, end: number): Promise<Track> {
  const t = lib.get(id)
  const ffmpeg = bins.ffmpegPath
  if (!t) throw new Error('Трек не найден')
  if (!ffmpeg) throw new Error('ffmpeg ещё не готов')
  if (!existsSync(t.file)) throw new Error('Файл трека не найден на диске')
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Некорректные границы')
  start = Math.max(0, start)
  end = Math.min(end, t.duration > 0 ? t.duration : end)
  if (end - start < 0.5) throw new Error('Фрагмент должен быть не короче полусекунды')

  const ext = extname(t.file).slice(1).toLowerCase() || 'm4a'
  const out = uniquePath(musicDir, sanitizeFilename(`${t.artist} - ${t.title} (${stamp(start)}–${stamp(end)})`), ext)
  if (!(await trimAudio(ffmpeg, t.file, out, ext, start, end))) {
    rmSync(out, { force: true })
    throw new Error('ffmpeg не смог вырезать фрагмент из этого файла')
  }
  const [added] = await importLocalFiles([out], lib, bins, musicDir)
  if (!added) throw new Error('Фрагмент вырезан, но не добавился в библиотеку')
  const edited = lib.edit(added.id, { title: `${t.title} (${label(start)}–${label(end)})`, artist: t.artist, album: t.album ?? '', year: t.year ?? 0 }) ?? added
  // обложка исходного трека, если в файл она не вшита
  const src = join(coversDir(), `${t.id}.jpg`)
  if (!edited.hasCover && t.hasCover && existsSync(src)) {
    copyFileSync(src, join(coversDir(), `${edited.id}.jpg`))
    return lib.update(edited.id, { hasCover: true, coverRev: edited.coverRev + 1 }) ?? edited
  }
  return edited
}
