import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, ListPlus, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import type { LyricLine, Track } from '@shared/types'
import { engine } from '@/lib/audio'
import { fmtTime, tracksWord } from '@/lib/format'
import { useClock } from '@/lib/hooks'
import { useLibrary } from '@/store/library'
import { useLyrics } from '@/store/lyrics'
import { usePlayer } from '@/store/player'
import { useUI } from '@/store/ui'
import { Modal } from './Overlays'
import { TrimModal } from './TrimModal'

function EditTrack({ track, onClose }: { track: Track; onClose: () => void }) {
  const live = useLibrary((s) => s.byId[track.id]) ?? track
  const [f, setF] = useState({ title: track.title, artist: track.artist, album: track.album ?? '', year: track.year ? String(track.year) : '' })
  const toast = useUI((s) => s.toast)
  const save = async () => {
    await window.wave.library.edit(track.id, { title: f.title, artist: f.artist, album: f.album, year: Number(f.year) || 0 })
    onClose()
  }
  const pickCover = async () => {
    const p = await window.wave.app.pickImage()
    if (!p) return
    toast((await window.wave.library.replaceCover(track.id, p)) ? 'Обложка обновлена' : 'Не удалось обновить обложку', 'info')
  }
  return (
    <Modal
      title="Данные трека"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" onClick={save}>Сохранить</button></>}
    >
      <div className="form">
        <label>Название<input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></label>
        <label>Исполнитель<input className="input" value={f.artist} onChange={(e) => setF({ ...f, artist: e.target.value })} /></label>
        <label>Альбом<input className="input" value={f.album} onChange={(e) => setF({ ...f, album: e.target.value })} /></label>
        <label>Год<input className="input" inputMode="numeric" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
        <button className="btn" onClick={pickCover}><ImagePlus size={16} /> {live.hasCover ? 'Заменить обложку' : 'Добавить обложку'}</button>
      </div>
    </Modal>
  )
}

function PickPlaylist({ trackIds, onClose }: { trackIds: string[]; onClose: () => void }) {
  const playlists = useLibrary((s) => s.playlists)
  const openModal = useUI((s) => s.openModal)
  const toast = useUI((s) => s.toast)
  return (
    <Modal title="Добавить в плейлист" onClose={onClose} width={400}>
      <div className="pick-list">
        <button className="pick-row" onClick={() => openModal({ kind: 'new-playlist', trackIds })}>
          <span className="ic"><Plus size={18} /></span> Новый плейлист
        </button>
        {playlists.map((p) => (
          <button
            key={p.id}
            className="pick-row"
            onClick={async () => {
              await window.wave.library.addToPlaylist(p.id, trackIds)
              toast(`Добавлено в «${p.name}»: ${tracksWord(trackIds.length)}`, 'success')
              onClose()
            }}
          >
            <span className="ic"><ListPlus size={18} /></span>
            <span>{p.name}</span>
            <em>{p.trackIds.length}</em>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function TextPrompt({ title, initial, placeholder, confirm, onSubmit, onClose }: { title: string; initial?: string; placeholder?: string; confirm: string; onSubmit: (v: string) => void | Promise<void>; onClose: () => void }) {
  const [v, setV] = useState(initial ?? '')
  const submit = async () => {
    if (!v.trim()) return
    await onSubmit(v.trim())
    onClose()
  }
  return (
    <Modal title={title} onClose={onClose} width={400} footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" disabled={!v.trim()} onClick={submit}>{confirm}</button></>}>
      <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus />
    </Modal>
  )
}

function LyricsPaste({ track, onClose }: { track: Track; onClose: () => void }) {
  const [text, setText] = useState('')
  const setData = useLyrics((s) => s.set)
  const save = async () => {
    setData(track.id, await window.wave.lyrics.setManual(track.id, text))
    onClose()
  }
  return (
    <Modal
      title={`Текст: ${track.title}`}
      onClose={onClose}
      width={620}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" disabled={!text.trim()} onClick={save}>Сохранить</button></>}
    >
      <p className="hint">Вставьте обычный текст или файл .lrc с метками времени вида <code>[01:23.45]</code> — тогда заработает караоке.</p>
      <textarea className="input area" value={text} onChange={(e) => setText(e.target.value)} placeholder="[00:12.30] Первая строка…" autoFocus spellCheck={false} />
    </Modal>
  )
}

const TAP_LATENCY = 0.15

function SyncEditor({ track, onClose }: { track: Track; onClose: () => void }) {
  const data = useLyrics((s) => s.byId[track.id])
  const setData = useLyrics((s) => s.set)
  const lines = useMemo(
    () =>
      (data?.plain ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^\[.*\]$/.test(l)),
    [data?.plain]
  )
  const [stamps, setStamps] = useState<(number | null)[]>(() => lines.map(() => null))
  const [cursor, setCursor] = useState(0)
  const playing = usePlayer((s) => s.playing)
  const currentId = usePlayer((s) => s.currentId)
  const time = useClock(10)
  const listRef = useRef<HTMLDivElement>(null)

  const stamp = () => {
    if (cursor >= lines.length) return
    setStamps((s) => s.map((v, i) => (i === cursor ? Math.max(0, engine.time - TAP_LATENCY) : v)))
    setCursor((c) => c + 1)
  }
  const undo = () => {
    if (cursor === 0) return
    setStamps((s) => s.map((v, i) => (i === cursor - 1 ? null : v)))
    setCursor((c) => c - 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        stamp()
      } else if (e.code === 'Backspace') {
        e.preventDefault()
        undo()
      } else if (e.code === 'ArrowLeft') engine.seek(engine.time - 3)
      else if (e.code === 'ArrowRight') engine.seek(engine.time + 3)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => {
    listRef.current?.querySelector('.cur')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [cursor])

  const start = () => {
    const p = usePlayer.getState()
    if (p.currentId !== track.id) p.playTracks([track.id])
    else {
      engine.seek(0)
      if (!p.playing) p.toggle()
    }
    setStamps(lines.map(() => null))
    setCursor(0)
  }

  const done = stamps.filter((s) => s !== null).length
  const save = async () => {
    const out: LyricLine[] = []
    lines.forEach((text, i) => stamps[i] !== null && out.push({ t: stamps[i]!, text }))
    setData(track.id, await window.wave.lyrics.setSynced(track.id, out))
    onClose()
  }

  return (
    <Modal
      title="Ручная синхронизация"
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="muted">Размечено {done} из {lines.length}</span>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={done < 2} onClick={save}>Сохранить</button>
        </>
      }
    >
      <p className="hint">Нажимайте <kbd>Пробел</kbd> в момент, когда начинается строка. <kbd>⌫</kbd> — шаг назад, <kbd>←</kbd>/<kbd>→</kbd> — перемотка на 3 с.</p>
      <div className="sync-bar">
        <button className="btn" onClick={start}><RotateCcw size={15} /> С начала</button>
        <button className="btn" onClick={() => usePlayer.getState().toggle()} disabled={currentId !== track.id}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <span className="time">{fmtTime(time)}</span>
        <button className="btn primary" onClick={stamp} disabled={cursor >= lines.length}>Отметить строку</button>
      </div>
      <div className="sync-list" ref={listRef}>
        {lines.map((l, i) => (
          <div key={i} className={`sync-line ${i === cursor ? 'cur' : ''} ${stamps[i] !== null ? 'ok' : ''}`} onClick={() => setCursor(i)}>
            <span className="ts">{stamps[i] !== null ? fmtTime(stamps[i]!) : '—'}</span>
            <span>{l}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function ModalHost() {
  const modal = useUI((s) => s.modal)
  const close = useUI((s) => s.closeModal)
  const toast = useUI((s) => s.toast)
  if (!modal) return null
  switch (modal.kind) {
    case 'edit-track':
      return <EditTrack track={modal.track} onClose={close} />
    case 'trim':
      return <TrimModal track={modal.track} onClose={close} />
    case 'pick-playlist':
      return <PickPlaylist trackIds={modal.trackIds} onClose={close} />
    case 'new-playlist':
      return (
        <TextPrompt
          title="Новый плейлист"
          placeholder="Название"
          confirm="Создать"
          onClose={close}
          onSubmit={async (name) => {
            await window.wave.library.createPlaylist(name, modal.trackIds)
            toast(`Плейлист «${name}» создан`, 'success')
          }}
        />
      )
    case 'rename-playlist':
      return <TextPrompt title="Переименовать плейлист" initial={modal.name} confirm="Сохранить" onClose={close} onSubmit={(n) => window.wave.library.renamePlaylist(modal.id, n)} />
    case 'manual-url':
      return (
        <TextPrompt
          title="Указать ссылку на источник"
          placeholder="https://www.youtube.com/watch?v=…"
          confirm="Скачать"
          onClose={close}
          onSubmit={(url) => window.wave.downloads.retry(modal.jobId, url)}
        />
      )
    case 'prompt':
      return <TextPrompt title={modal.title} initial={modal.initial} placeholder={modal.placeholder} confirm={modal.confirmLabel} onClose={close} onSubmit={modal.onSubmit} />
    case 'lyrics-paste':
      return <LyricsPaste track={modal.track} onClose={close} />
    case 'sync-editor':
      return <SyncEditor track={modal.track} onClose={close} />
    case 'confirm':
      return (
        <Modal
          title={modal.title}
          onClose={close}
          width={420}
          footer={
            <>
              <button className="btn" onClick={close}>Отмена</button>
              <button className={`btn ${modal.danger ? 'danger' : 'primary'}`} onClick={() => (close(), modal.onConfirm())}>{modal.confirmLabel}</button>
            </>
          }
        >
          <p>{modal.text}</p>
        </Modal>
      )
  }
}
