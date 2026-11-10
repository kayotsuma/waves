import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ClipboardPaste, ExternalLink, Loader2, Minus, Music2, Plus, RefreshCw, Timer } from 'lucide-react'
import type { LyricLine, LyricsData, Track } from '@shared/types'
import { engine } from '@/lib/audio'
import { clamp } from '@/lib/format'
import { useLyrics } from '@/store/lyrics'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

/** Запрос для ручного поиска на Genius: без «(@ника)» у исполнителя и без «(prod. by …)» в названии. */
const geniusSearch = (t: Track) => {
  const artist = (t.artists[0] ?? t.artist).replace(/\(?\s*@[\w.]+\s*\)?/g, '').trim()
  const title = t.title.replace(/\s*[([{][^)\]}]*(?:prod|feat|ft\.)[^)\]}]*[)\]}]/gi, '').trim()
  return `https://genius.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`
}

/** Выбор страницы Genius вручную: найденные варианты и поле для ссылки (название на Genius может быть переведено или написано иначе). */
function GeniusPicker({ track, candidates }: { track: Track; candidates?: LyricsData['geniusCandidates'] }) {
  const setData = useLyrics((s) => s.set)
  const toast = useUI((s) => s.toast)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const use = async (link: string) => {
    setBusy(true)
    try {
      setData(track.id, await window.wave.lyrics.setGeniusUrl(track.id, link))
      toast('Текст с Genius получен', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Не удалось получить текст', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="genius-picker">
      {!!candidates?.length && (
        <>
          <h4>Найдено на Genius</h4>
          <div className="gp-list">
            {candidates.map((c) => (
              <button key={c.url} className="gp-item" disabled={busy} onClick={() => use(c.url)} title={c.url}>
                <span className="t1">{c.title}</span>
                <span className="t2">{c.artist}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <form
        className="gp-url"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) void use(url)
        }}
      >
        <input className="input" placeholder="Ссылка на страницу Genius: https://genius.com/…-lyrics" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={busy || !url.trim()}>{busy ? 'Загружаю…' : 'Загрузить'}</button>
      </form>
    </div>
  )
}

/** Почему строки пока разложены примерно и что с синхронизацией по звуку. */
function AlignNote({ trackId, data }: { trackId: string; data: LyricsData }) {
  const align = useLyrics((s) => s.align)
  const enabled = useSettings((s) => s.settings.download.alignLyrics)
  const working = align?.current === trackId
  const queued = !!align?.queued.includes(trackId)
  const mismatch = !!data.alignAttempt && !working && !queued
  let text: string
  if (working && align?.model === 'downloading') text = `Скачиваю модель для синхронизации по звуку — ${Math.round((align.progress ?? 0) * 100)}%. Это один раз; потом строки встанут на место сами.`
  else if (working) text = `Синхронизирую текст по звуку — ${Math.round((align?.currentProgress ?? 0) * 100)}%. Пока строки разложены примерно.`
  else if (queued && align?.model === 'downloading') text = `Скачиваю модель для синхронизации по звуку — ${Math.round((align.progress ?? 0) * 100)}%. Трек в очереди.`
  else if (queued) text = 'Трек в очереди на синхронизацию по звуку. Пока строки разложены примерно.'
  else if (mismatch) text = 'Текст не совпал со звуком этой версии трека (возможно, это текст другой песни или ремикса), поэтому строки разложены примерно. Выберите другую страницу Genius или нажмите «Точная синхронизация».'
  else if (!enabled) text = 'Точных таймингов не нашлось, строки разложены примерно. Включите «Синхронизировать по звуку» в настройках загрузок — или нажмите «Точная синхронизация».'
  else text = 'Точных таймингов для этой песни не нашлось, поэтому строки разложены по времени примерно. Подстройте сдвигом справа или нажмите «Точная синхронизация».'
  return (
    <div className="note left">
      {working || queued ? <Loader2 size={15} className="spin" /> : <AlertCircle size={15} />}
      <span>{text}</span>
    </div>
  )
}

const SOURCE_LABEL: Record<string, string> = { lrclib: 'LRCLIB', yandex: 'Яндекс Музыка', genius: 'Genius', file: '.lrc файл', manual: 'вручную', estimated: 'примерно по тексту', aligned: 'синхронизировано по звуку' }

function findActive(lines: LyricLine[], time: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t <= time) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** Длительность «заливки» строки: не дольше, чем до следующей, и пропорциональна длине. */
function sweepDuration(lines: LyricLine[], i: number): number {
  const l = lines[i]
  const next = lines[i + 1]?.t ?? l.t + 6
  return Math.max(0.5, Math.min(next - l.t - 0.05, l.text.length * 0.115 + 0.9))
}

const KaraokeLine = memo(function KaraokeLine({
  line,
  state,
  dist,
  words,
  setRef,
  onClick
}: {
  line: LyricLine
  state: 'past' | 'active' | 'future'
  dist: number
  words: boolean
  setRef: (el: HTMLDivElement | null) => void
  onClick: () => void
}) {
  return (
    <div ref={setRef} className={`kl ${state} ${line.text ? '' : 'gap'}`} style={{ ['--d' as string]: dist }} onClick={onClick}>
      {line.text ? (
        words && line.words ? (
          <span className="kt">
            {line.words.map((w, k) => (
              <span className="kw" key={k}>
                {w.text}
              </span>
            ))}
          </span>
        ) : (
          <span className="kt">{line.text}</span>
        )
      ) : (
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  )
})

function Karaoke({ lines, offset }: { lines: LyricLine[]; offset: number }) {
  const ap = useSettings((s) => s.settings.appearance)
  const wrap = useRef<HTMLDivElement>(null)
  const els = useRef<(HTMLDivElement | null)[]>([])
  const [active, setActive] = useState(-1)
  const activeRef = useRef(-1)
  const offsetRef = useRef(offset)
  const holdUntil = useRef(0)
  offsetRef.current = offset

  useEffect(() => {
    els.current = els.current.slice(0, lines.length)
    activeRef.current = -2 // форсируем обновление
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const time = engine.time + offsetRef.current
      const idx = findActive(lines, time)
      if (idx !== activeRef.current) {
        activeRef.current = idx
        setActive(idx)
      }
      if (idx < 0 || !ap.lyricsWordSweep) return
      const el = els.current[idx]
      if (!el) return
      const line = lines[idx]
      if (line.words?.length) {
        const spans = el.querySelectorAll<HTMLElement>('.kw')
        line.words.forEach((w, k) => {
          const end = line.words![k + 1]?.t ?? w.t + Math.max(0.3, w.text.length * 0.1)
          const p = clamp((time - w.t) / Math.max(0.05, end - w.t), 0, 1) * 100
          spans[k]?.style.setProperty('--p', p.toFixed(1))
        })
      } else {
        const p = clamp((time - line.t) / sweepDuration(lines, idx), 0, 1) * 100
        el.style.setProperty('--p', p.toFixed(1))
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [lines, ap.lyricsWordSweep])

  useEffect(() => {
    const el = els.current[active]
    const box = wrap.current
    if (!el || !box || Date.now() < holdUntil.current) return
    box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.34 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [active])

  const hold = () => (holdUntil.current = Date.now() + 3500)

  return (
    <div
      ref={wrap}
      className="karaoke"
      data-align={ap.lyricsAlign}
      data-blur={ap.lyricsBlurFar}
      data-sweep={ap.lyricsWordSweep}
      style={{ fontSize: ap.lyricsSize }}
      onWheel={hold}
      onTouchMove={hold}
      onPointerDown={hold}
    >
      <div className="pad" />
      {lines.map((l, i) => (
        <KaraokeLine
          key={i}
          line={l}
          state={i === active ? 'active' : i < active ? 'past' : 'future'}
          dist={Math.min(5, Math.abs(i - active))}
          words={ap.lyricsWordSweep}
          setRef={(el) => (els.current[i] = el)}
          onClick={() => {
            holdUntil.current = 0
            usePlayer.getState().seek(Math.max(0, l.t - offsetRef.current))
            if (!usePlayer.getState().playing) usePlayer.getState().toggle()
          }}
        />
      ))}
      <div className="pad" />
    </div>
  )
}

function PlainText({ text }: { text: string }) {
  const size = useSettings((s) => s.settings.appearance.lyricsSize)
  const align = useSettings((s) => s.settings.appearance.lyricsAlign)
  const lines = useMemo(() => text.split('\n'), [text])
  return (
    <div className="plain" data-align={align} style={{ fontSize: Math.max(15, size * 0.52) }}>
      {lines.map((l, i) =>
        /^\[.*\]$/.test(l.trim()) ? (
          <div key={i} className="sec">
            {l.trim().slice(1, -1)}
          </div>
        ) : l.trim() === '' ? (
          <div key={i} className="gap-line" />
        ) : (
          <div key={i}>{l}</div>
        )
      )}
    </div>
  )
}

export function LyricsView({ track, compact }: { track: Track; compact?: boolean }) {
  const status = useLyrics((s) => s.status[track.id] ?? 'idle')
  const data = useLyrics((s) => s.byId[track.id]) as LyricsData | null | undefined
  const load = useLyrics((s) => s.load)
  const setData = useLyrics((s) => s.set)
  const openModal = useUI((s) => s.openModal)
  const toast = useUI((s) => s.toast)
  const [mode, setMode] = useState<'karaoke' | 'text'>('karaoke')

  const askGenius = async () => {
    await load(track.id, { genius: true })
    const d = useLyrics.getState().byId[track.id]
    if (d?.plainSource === 'genius') toast('Текст с Genius получен', 'success')
    else toast(d?.geniusNote ?? 'Не удалось получить текст с Genius', 'error')
  }

  useEffect(() => {
    void load(track.id)
  }, [track.id, load])

  const hasSynced = !!data?.synced?.length
  const hasPlain = !!data?.plain
  const view: 'karaoke' | 'text' = hasSynced && (mode === 'karaoke' || !hasPlain) ? 'karaoke' : 'text'
  const offset = data?.offset ?? 0

  const changeOffset = async (delta: number) => {
    const next = Math.round((offset + delta) * 100) / 100
    if (data) setData(track.id, { ...data, offset: next })
    const saved = await window.wave.lyrics.setOffset(track.id, next)
    if (saved) setData(track.id, saved)
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="lyrics-empty">
        <Loader2 className="spin" size={22} />
        <p>Ищу текст…</p>
      </div>
    )
  }

  if (!data || (!hasSynced && !hasPlain)) {
    return (
      <div className="lyrics-empty">
        <Music2 size={28} strokeWidth={1.5} />
        <p>{status === 'error' ? 'Не удалось получить текст.' : 'Текст не найден.'}</p>
        {data?.geniusNote && (
          <div className="note warn left"><AlertCircle size={15} /><span>{data.geniusNote}</span></div>
        )}
        <GeniusPicker track={track} candidates={data?.geniusCandidates} />
        <div className="btn-row">
          <button className="btn" onClick={() => load(track.id, { force: true })}>
            <RefreshCw size={15} /> Искать снова
          </button>
          <button className="btn" onClick={askGenius}>Спросить Genius</button>
          <button className="btn" onClick={() => window.wave.app.openExternal(geniusSearch(track))}>
            <ExternalLink size={15} /> Открыть Genius
          </button>
          <button className="btn" onClick={() => openModal({ kind: 'lyrics-paste', track })}>
            <ClipboardPaste size={15} /> Вставить текст
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`lyrics ${compact ? 'compact' : ''}`}>
      <div className="lyrics-bar">
        <div className="seg">
          {hasSynced && (
            <button className={view === 'karaoke' ? 'on' : ''} onClick={() => setMode('karaoke')}>
              Караоке
            </button>
          )}
          {hasPlain && (
            <button className={view === 'text' ? 'on' : ''} onClick={() => setMode('text')}>
              Текст
            </button>
          )}
        </div>
        <span className="src">
          {view === 'karaoke' ? SOURCE_LABEL[data.syncedSource ?? ''] : SOURCE_LABEL[data.plainSource ?? '']}
        </span>
        <div className="spacer" />
        {view === 'karaoke' && (
          <div className="offset" title="Сдвиг синхронизации (если строки идут не в такт)">
            <Timer size={14} />
            <button onClick={() => changeOffset(-0.25)} aria-label="Позже">
              <Minus size={14} />
            </button>
            <span>{offset > 0 ? '+' : ''}{offset.toFixed(2)}с</span>
            <button onClick={() => changeOffset(0.25)} aria-label="Раньше">
              <Plus size={14} />
            </button>
          </div>
        )}
        {!hasPlain || data.plainSource !== 'genius' ? (
          <button className="btn sm" onClick={askGenius} title="Попробовать получить текст с Genius">
            Genius
          </button>
        ) : (
          data.geniusUrl && (
            <button className="icon-btn" title="Открыть на Genius" onClick={() => window.wave.app.openExternal(data.geniusUrl!)}>
              <ExternalLink size={15} />
            </button>
          )
        )}
        {(!hasSynced || data.syncedSource === 'estimated') && hasPlain && (
          <button className="btn sm" onClick={() => openModal({ kind: 'sync-editor', track })} title="Расставить тайминги вручную">
            {data.syncedSource === 'estimated' ? 'Точная синхронизация' : 'Синхронизировать'}
          </button>
        )}
        <button className="icon-btn" title="Вставить свой текст / LRC" onClick={() => openModal({ kind: 'lyrics-paste', track })}>
          <ClipboardPaste size={15} />
        </button>
        <button className="icon-btn" title="Найти заново" onClick={() => load(track.id, { force: true })}>
          <RefreshCw size={15} />
        </button>
      </div>
      {view === 'karaoke' && data.syncedSource === 'estimated' && <AlignNote trackId={track.id} data={data} />}
      {data.geniusNote && data.plainSource !== 'genius' && (
        <div className="note warn left">
          <AlertCircle size={15} />
          <span>{data.geniusNote}</span>
          <button className="btn sm" onClick={() => window.wave.app.openExternal(geniusSearch(track))}>Открыть Genius</button>
        </div>
      )}
      {data.plainSource !== 'genius' && (data.geniusNote || !!data.geniusCandidates?.length) && <GeniusPicker track={track} candidates={data.geniusCandidates} />}
      {view === 'karaoke' ? <Karaoke lines={data.synced!} offset={offset} /> : <PlainText text={data.plain!} />}
    </div>
  )
}
