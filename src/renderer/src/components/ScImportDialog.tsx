import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Heart, ListMusic, Loader2, Search } from 'lucide-react'
import type { ImportItem } from '@shared/types'
import { tracksWord } from '@/lib/format'
import { useUI } from '@/store/ui'
import { Modal } from './Overlays'

type Profile = Awaited<ReturnType<typeof window.wave.imports.scProfile>>

const clean = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Импорт публичных лайков и плейлистов профиля SoundCloud (лайки попадают в «Любимое», плейлисты — отдельными плейлистами). */
export function ScImportDialog() {
  const open = useUI((s) => s.scImportOpen)
  const close = () => useUI.getState().setScImportOpen(false)
  const toast = useUI((s) => s.toast)
  const navigate = useUI((s) => s.navigate)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [likes, setLikes] = useState(true)
  const [stream, setStream] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setInput('')
    setError('')
    setProfile(null)
    setBusy(null)
    setTimeout(() => ref.current?.focus(), 50)
  }, [open])

  if (!open) return null

  const find = async () => {
    if (!input.trim()) return
    setBusy('Ищу профиль…')
    setError('')
    setProfile(null)
    try {
      const p = await window.wave.imports.scProfile(input)
      setProfile(p)
      setPicked(new Set(p.playlists.map((x) => x.url)))
      setLikes(true)
    } catch (e) {
      setError(clean((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  const run = async () => {
    if (!profile) return
    let queued = 0
    const problems: string[] = []
    try {
      if (likes) {
        setBusy('Читаю лайки…')
        try {
          const pv = await window.wave.imports.resolve(profile.likesUrl)
          queued += await window.wave.imports.start(pv.items as ImportItem[], { like: true, stream })
        } catch (e) {
          problems.push(`лайки: ${clean((e as Error).message)}`)
        }
      }
      const lists = profile.playlists.filter((p) => picked.has(p.url))
      for (let i = 0; i < lists.length; i++) {
        setBusy(`Плейлист ${i + 1} из ${lists.length}: ${lists[i].title}`)
        try {
          const pv = await window.wave.imports.resolve(lists[i].url)
          queued += await window.wave.imports.start(pv.items as ImportItem[], { playlistName: lists[i].title, stream })
        } catch (e) {
          problems.push(`«${lists[i].title}»: ${clean((e as Error).message)}`)
        }
      }
    } finally {
      setBusy(null)
    }
    if (problems.length) toast(`Не всё удалось: ${problems.join('; ').slice(0, 220)}`, 'error')
    toast(queued ? (stream ? `Добавлено в библиотеку: ${tracksWord(queued)}` : `В очереди загрузки: ${tracksWord(queued)}`) : 'Новых треков нет — всё уже в библиотеке', queued ? 'success' : 'info')
    close()
    if (queued && !stream) navigate({ name: 'downloads' })
  }

  const nothing = !likes && picked.size === 0

  return (
    <Modal
      title="Импорт из SoundCloud"
      onClose={close}
      width={620}
      footer={
        profile ? (
          <>
            <label className="check foot-left" title="Файлы не сохраняются: звук берётся из интернета при воспроизведении">
              <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />
              <span>Без скачивания (слушать онлайн)</span>
            </label>
            <button className="btn" onClick={close}>Отмена</button>
            <button className="btn primary" disabled={!!busy || nothing} onClick={run}>
              {busy ? <Loader2 size={16} className="spin" /> : null} Импортировать
            </button>
          </>
        ) : undefined
      }
    >
      <form className="import-input" onSubmit={(e) => { e.preventDefault(); void find() }}>
        <Search size={17} />
        <input ref={ref} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Имя профиля или ссылка: soundcloud.com/имя" spellCheck={false} />
        <button type="submit" className="btn primary sm" disabled={!input.trim() || !!busy}>Найти</button>
      </form>
      <p className="hint">Работает с публичными профилями. Войти в аккаунт не нужно: лайки и плейлисты читаются так же, как их видит любой посетитель.</p>
      {busy && <div className="center-msg"><Loader2 className="spin" size={22} /><p>{busy}</p></div>}
      {error && <div className="note err"><AlertCircle size={16} /> <span>{error}</span></div>}
      {profile && !busy && (
        <div className="sc-body">
          <h4>{profile.name}</h4>
          <label className="sc-row">
            <input type="checkbox" checked={likes} onChange={(e) => setLikes(e.target.checked)} />
            <span className="sc-ico"><Heart size={18} /></span>
            <span className="txt"><b>Лайки</b><small>попадут в «Любимое» (до 1000 последних)</small></span>
          </label>
          <div className="sc-sec">
            <span>Плейлисты · {profile.playlists.length}</span>
            {profile.playlists.length > 1 && (
              <button className="link" onClick={() => setPicked(picked.size === profile.playlists.length ? new Set() : new Set(profile.playlists.map((p) => p.url)))}>
                {picked.size === profile.playlists.length ? 'Снять все' : 'Выбрать все'}
              </button>
            )}
          </div>
          <div className="sc-list">
            {profile.playlists.length === 0 && <p className="muted small">Публичных плейлистов нет.</p>}
            {profile.playlists.map((p) => (
              <label key={p.url} className="sc-row">
                <input
                  type="checkbox"
                  checked={picked.has(p.url)}
                  onChange={(e) => {
                    const n = new Set(picked)
                    e.target.checked ? n.add(p.url) : n.delete(p.url)
                    setPicked(n)
                  }}
                />
                <span className="sc-ico"><ListMusic size={18} /></span>
                <span className="txt"><b>{p.title}</b></span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
