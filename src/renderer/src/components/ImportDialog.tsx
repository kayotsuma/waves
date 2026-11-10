import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Clipboard, Loader2, Search } from 'lucide-react'
import type { ImportItem, ImportPreview } from '@shared/types'
import { fmtTime, tracksWord } from '@/lib/format'
import { useDownloads } from '@/store/downloads'
import { useUI } from '@/store/ui'
import { Modal } from './Overlays'

const SOURCES = [
  { name: 'YouTube / YT Music', hint: 'видео, плейлисты, альбомы' },
  { name: 'SoundCloud', hint: 'треки, сеты, профили' },
  { name: 'Spotify', hint: 'трек, альбом, плейлист' },
  { name: 'Apple Music', hint: 'трек, альбом, плейлист' },
  { name: 'Deezer', hint: 'трек, альбом, плейлист' },
  { name: 'Яндекс Музыка', hint: 'трек, альбом, плейлист' }
]

type Phase = { name: 'idle' } | { name: 'loading' } | { name: 'error'; message: string } | { name: 'ready'; preview: ImportPreview }

export function ImportDialog() {
  const open = useUI((s) => s.importOpen)
  const prefill = useUI((s) => s.importPrefill)
  const close = useUI((s) => s.closeImport)
  const toast = useUI((s) => s.toast)
  const navigate = useUI((s) => s.navigate)
  const tools = useDownloads((s) => s.tools)

  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [asPlaylist, setAsPlaylist] = useState(false)
  const [plName, setPlName] = useState('')
  const [starting, setStarting] = useState(false)
  const [stream, setStream] = useState(() => {
    try {
      return localStorage.getItem('wave.importStream') === '1'
    } catch {
      return false
    }
  })
  const reqId = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const resolve = async (text: string) => {
    const value = text.trim()
    if (!value) return
    const my = ++reqId.current
    setPhase({ name: 'loading' })
    try {
      const preview = await window.wave.imports.resolve(value)
      if (my !== reqId.current) return
      setPhase({ name: 'ready', preview })
      setSelected(new Set(preview.items.filter((i) => !i.inLibrary).map((i) => i.key)))
      const multi = preview.items.length > 1 && preview.kind !== 'album'
      setAsPlaylist(multi && !preview.title.startsWith('Поиск:'))
      setPlName(preview.title.replace(/^Поиск:\s*/, ''))
    } catch (e) {
      if (my !== reqId.current) return
      setPhase({ name: 'error', message: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  useEffect(() => {
    if (!open) return
    setInput(prefill)
    setPhase({ name: 'idle' })
    setStarting(false)
    if (prefill) void resolve(prefill)
    else setTimeout(() => inputRef.current?.focus(), 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill])

  const preview = phase.name === 'ready' ? phase.preview : null
  const chosen = useMemo(() => preview?.items.filter((i) => selected.has(i.key)) ?? [], [preview, selected])

  if (!open) return null

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setInput(text)
        void resolve(text)
      }
    } catch {
      toast('Нет доступа к буферу обмена — вставьте через Ctrl+V', 'error')
    }
  }

  const start = async () => {
    if (!preview || !chosen.length) return
    setStarting(true)
    try {
      const n = await window.wave.imports.start(chosen as ImportItem[], { ...(asPlaylist && plName.trim() ? { playlistName: plName.trim() } : {}), stream })
      toast(n ? (stream ? `Добавлено в библиотеку: ${tracksWord(n)}` : `В очереди загрузки: ${tracksWord(n)}`) : 'Всё это уже есть в библиотеке', n ? 'success' : 'info')
      close()
      if (n && !stream) navigate({ name: 'downloads' })
    } catch (e) {
      toast((e as Error).message, 'error')
      setStarting(false)
    }
  }

  const toolsNote =
    tools?.ytdlp.state === 'downloading'
      ? `Устанавливаю yt-dlp… ${Math.round(tools.ytdlp.progress * 100)}%`
      : tools?.ytdlp.state === 'error'
        ? `yt-dlp недоступен: ${tools.ytdlp.message}`
        : tools?.ytdlp.state === 'missing'
          ? 'yt-dlp ещё не установлен'
          : null

  return (
    <Modal
      title="Добавить музыку"
      onClose={close}
      width={680}
      footer={
        preview ? (
          <>
            <div className="foot-left">
              {preview.items.length > 1 && preview.kind !== 'album' && (
                <label className="check">
                  <input type="checkbox" checked={asPlaylist} onChange={(e) => setAsPlaylist(e.target.checked)} />
                  <span>Сохранить как плейлист</span>
                </label>
              )}
              <label className="check" title="Файл не сохраняется на диск: звук берётся из интернета при воспроизведении">
                <input
                  type="checkbox"
                  checked={stream}
                  onChange={(e) => {
                    setStream(e.target.checked)
                    try {
                      localStorage.setItem('wave.importStream', e.target.checked ? '1' : '0')
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                <span>Без скачивания (слушать онлайн)</span>
              </label>
              {asPlaylist && preview.items.length > 1 && (
                <input className="input sm" value={plName} onChange={(e) => setPlName(e.target.value)} placeholder="Название плейлиста" />
              )}
            </div>
            <button className="btn" onClick={close}>Отмена</button>
            <button className="btn primary" disabled={!chosen.length || starting} onClick={start}>
              {starting ? <Loader2 size={16} className="spin" /> : null} {stream ? 'Добавить' : 'Скачать'} {chosen.length > 0 ? `(${chosen.length})` : ''}
            </button>
          </>
        ) : undefined
      }
    >
      <form
        className="import-input"
        onSubmit={(e) => {
          e.preventDefault()
          void resolve(input)
        }}
      >
        <Search size={17} />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (/^(https?:|spotify:)/i.test(text.trim())) {
              e.preventDefault()
              setInput(text.trim())
              void resolve(text)
            }
          }}
          placeholder="Вставьте ссылку или введите название песни…"
          spellCheck={false}
          autoFocus
        />
        <button type="button" className="icon-btn" onClick={paste} title="Вставить из буфера"><Clipboard size={17} /></button>
        <button type="submit" className="btn primary sm" disabled={!input.trim() || phase.name === 'loading'}>Найти</button>
      </form>

      {toolsNote && <div className="note warn"><Loader2 size={14} className={tools?.ytdlp.state === 'downloading' ? 'spin' : ''} /> {toolsNote}</div>}

      {phase.name === 'idle' && (
        <div className="sources">
          {SOURCES.map((s) => (
            <div key={s.name} className="src-card">
              <strong>{s.name}</strong>
              <span>{s.hint}</span>
            </div>
          ))}
          <button className="src-card sc-import" onClick={() => useUI.getState().setScImportOpen(true)}>
            <strong>Профиль SoundCloud →</strong>
            <span>импорт лайков и плейлистов по имени</span>
          </button>
          <p className="hint wide">Можно просто написать «исполнитель — название»: приложение найдёт трек на YouTube Music.</p>
        </div>
      )}

      {phase.name === 'loading' && (
        <div className="center-msg"><Loader2 className="spin" size={26} /><p>Читаю ссылку…</p></div>
      )}

      {phase.name === 'error' && (
        <div className="note err"><AlertCircle size={16} /> <span>{phase.message}</span></div>
      )}

      {preview && (
        <>
          <div className="pv-head">
            {preview.coverUrl && <img src={preview.coverUrl} alt="" referrerPolicy="no-referrer" />}
            <div>
              <h4>{preview.title}</h4>
              <p className="muted">{[preview.subtitle, tracksWord(preview.items.length)].filter(Boolean).join(' · ')}</p>
            </div>
            {preview.items.length > 1 && (
              <button
                className="link"
                onClick={() =>
                  setSelected(selected.size === preview.items.length ? new Set() : new Set(preview.items.map((i) => i.key)))
                }
              >
                {selected.size === preview.items.length ? 'Снять все' : 'Выбрать все'}
              </button>
            )}
          </div>
          {preview.notes.map((n) => (
            <div key={n} className="note"><AlertCircle size={14} /> <span>{n}</span></div>
          ))}
          <div className="pv-list">
            {preview.items.map((it) => (
              <label key={it.key} className={`pv-row ${it.inLibrary ? 'dim' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(it.key)}
                  onChange={(e) => {
                    const n = new Set(selected)
                    e.target.checked ? n.add(it.key) : n.delete(it.key)
                    setSelected(n)
                  }}
                />
                {it.coverUrl ? <img src={it.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="ph" />}
                <div className="txt">
                  <div className="t1">{it.title}</div>
                  <div className="t2">{it.artists.join(', ')}{it.album ? ` · ${it.album}` : ''}</div>
                </div>
                {it.inLibrary && <span className="in-lib"><CheckCircle2 size={14} /> уже есть</span>}
                {it.duration ? <span className="time">{fmtTime(it.duration)}</span> : null}
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
