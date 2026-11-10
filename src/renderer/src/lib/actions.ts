import type { Track } from '@shared/types'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUI, type MenuItem } from '@/store/ui'
import { useLyrics } from '@/store/lyrics'
import { tracksWord } from './format'

/** Пункты контекстного меню для набора треков. */
export function trackMenu(tracks: Track[], opts: { playlistId?: string; onPlay?: () => void } = {}): MenuItem[] {
  const ui = useUI.getState()
  const player = usePlayer.getState()
  const ids = tracks.map((t) => t.id)
  const single = tracks.length === 1 ? tracks[0] : null
  const allLiked = tracks.every((t) => t.liked)
  const items: MenuItem[] = [
    { label: 'Играть', onClick: opts.onPlay ?? (() => player.playTracks(ids)) },
    { label: 'Играть следующим', onClick: () => (player.playNext(ids), ui.toast(`Следующим: ${tracksWord(ids.length)}`)) },
    { label: 'Добавить в очередь', onClick: () => (player.enqueue(ids), ui.toast(`В очереди: ${tracksWord(ids.length)}`)) },
    { separator: true },
    { label: 'Добавить в плейлист…', onClick: () => ui.openModal({ kind: 'pick-playlist', trackIds: ids }) },
    {
      label: allLiked ? 'Убрать из любимых' : 'В любимые',
      onClick: () => tracks.filter((t) => t.liked === allLiked).forEach((t) => void window.wave.library.like(t.id))
    }
  ]
  if (opts.playlistId) {
    items.push({
      label: 'Убрать из плейлиста',
      onClick: () => void window.wave.library.removeFromPlaylist(opts.playlistId!, ids)
    })
  }
  if (single) {
    items.push(
      { separator: true },
      { label: 'Изменить данные…', onClick: () => ui.openModal({ kind: 'edit-track', track: single }) },
      ...(single.remote ? [] : [{ label: 'Вырезать фрагмент…', onClick: () => ui.openModal({ kind: 'trim', track: single }) }]),
      {
        label: 'Найти текст заново',
        onClick: () => {
          ui.toast('Ищу текст…')
          void useLyrics.getState().load(single.id, { force: true })
        }
      },
      ...(single.remote ? [] : [{ label: 'Показать в папке', onClick: () => void window.wave.app.showInFolder(single.file) }])
    )
    if (single.source.url && /^https?:/.test(single.source.url))
      items.push({ label: 'Открыть источник', onClick: () => void window.wave.app.openExternal(single.source.url!) })
  }
  items.push(
    { separator: true },
    {
      label: 'Удалить из библиотеки…',
      danger: true,
      onClick: () =>
        ui.openModal({
          kind: 'confirm',
          title: 'Удалить из библиотеки?',
          text: `${tracksWord(ids.length)} будет удалено вместе с файлами из папки Wave. Файлы, добавленные «как есть» с вашего диска, останутся нетронутыми.`,
          confirmLabel: 'Удалить',
          danger: true,
          onConfirm: () => void window.wave.library.remove(ids, true)
        })
    }
  )
  return items
}

export function trackById(id: string | null | undefined): Track | undefined {
  return id ? useLibrary.getState().byId[id] : undefined
}
