import { memo, useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Heart, MoreHorizontal, Pause, Play } from 'lucide-react'
import type { Track } from '@shared/types'
import { trackMenu } from '@/lib/actions'
import { fmtDate, fmtTime, quality, ROW_H } from '@/lib/format'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { Cover } from './Cover'

interface RowProps {
  track: Track
  index: number
  selected: boolean
  isCurrent: boolean
  playing: boolean
  showAlbum: boolean
  showDate: boolean
  top: number
  height: number
  onClick: (e: React.MouseEvent, t: Track, i: number) => void
  onDouble: (i: number) => void
  onMenu: (e: React.MouseEvent, t: Track) => void
}

const Row = memo(function Row({ track: t, index, selected, isCurrent, playing, showAlbum, showDate, top, height, onClick, onDouble, onMenu }: RowProps) {
  const q = quality(t)
  return (
    <div
      className={`row ${selected ? 'selected' : ''} ${isCurrent ? 'current' : ''} ${t.missing ? 'missing' : ''}`}
      style={{ transform: `translateY(${top}px)`, height }}
      onClick={(e) => onClick(e, t, index)}
      onDoubleClick={() => onDouble(index)}
      onContextMenu={(e) => onMenu(e, t)}
      role="row"
      aria-selected={selected}
    >
      <div className="c-idx">
        {isCurrent && playing ? (
          <span className="eq-bars" aria-label="Играет">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="num">{index + 1}</span>
        )}
        <button className="play-hover" onClick={(e) => (e.stopPropagation(), onDouble(index))} aria-label="Играть">
          {isCurrent && playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
      </div>
      <div className="c-title">
        <Cover track={t} size={height - 14} radius={6} />
        <div className="txt">
          <div className="t1">{t.title}</div>
          <div className="t2">{t.artist}</div>
        </div>
      </div>
      {showAlbum && <div className="c-album">{t.album ?? '—'}</div>}
      {showDate && <div className="c-date">{fmtDate(t.addedAt)}</div>}
      <div className="c-q">
        <span className={`qbadge ${q.tier}`} title={q.detail}>
          {q.label}
          {q.short && <small>{q.short}</small>}
        </span>
      </div>
      <button
        className={`c-like ${t.liked ? 'on' : ''}`}
        onClick={(e) => (e.stopPropagation(), void window.wave.library.like(t.id))}
        aria-label={t.liked ? 'Убрать из любимых' : 'В любимые'}
      >
        <Heart size={16} fill={t.liked ? 'currentColor' : 'none'} />
      </button>
      <div className="c-time">{fmtTime(t.duration)}</div>
      <button className="c-more" onClick={(e) => (e.stopPropagation(), onMenu(e, t))} aria-label="Ещё">
        <MoreHorizontal size={18} />
      </button>
    </div>
  )
})

interface Props {
  tracks: Track[]
  scrollRef: RefObject<HTMLElement | null>
  playlistId?: string
  showAlbum?: boolean
  showDate?: boolean
}

export function TrackList({ tracks, scrollRef, playlistId, showAlbum = true, showDate = true }: Props) {
  const density = useSettings((s) => s.settings.appearance.density)
  const rowH = ROW_H[density] ?? ROW_H.comfortable
  const currentId = usePlayer((s) => s.currentId)
  const playing = usePlayer((s) => s.playing)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<number>(-1)
  const listRef = useRef<HTMLDivElement>(null)
  const [margin, setMargin] = useState(0)
  const [view, setView] = useState({ top: 0, h: 900 })

  // Своё окно видимых строк (вместо внешней библиотеки): замеры берутся синхронно при монтировании и при каждом
  // скролле, поэтому список появляется сразу, даже если ResizeObserver ещё не сработал.
  useLayoutEffect(() => {
    const el = listRef.current
    // При первом показе эффект списка срабатывает раньше, чем родитель присвоил ref контейнеру прокрутки,
    // поэтому ref ещё пуст — берём ближайший прокручиваемый контейнер. Иначе слушатель скролла не вешается,
    // и в длинном списке остаются отрисованными только первые строки.
    const sc = scrollRef.current ?? (el?.closest('.scroll') as HTMLElement | null)
    if (!sc || !el) return
    const measure = () => {
      setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop)
      setView((v) => (v.top === sc.scrollTop && v.h === sc.clientHeight ? v : { top: sc.scrollTop, h: sc.clientHeight }))
    }
    measure()
    const raf = requestAnimationFrame(measure)
    let pending = 0
    const onScroll = () => {
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        measure()
      })
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(sc)
    if (el.previousElementSibling) ro.observe(el.previousElementSibling)
    return () => {
      cancelAnimationFrame(raf)
      if (pending) cancelAnimationFrame(pending)
      sc.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [scrollRef, tracks.length])

  const OVERSCAN = 10
  const rel = view.top - margin
  const first = Math.max(0, Math.floor(rel / rowH) - OVERSCAN)
  const last = Math.min(tracks.length, Math.ceil((rel + view.h) / rowH) + OVERSCAN)
  const visible: number[] = []
  for (let i = first; i < last; i++) visible.push(i)

  const play = useCallback(
    (i: number) => {
      const p = usePlayer.getState()
      const t = tracks[i]
      if (t && p.currentId === t.id && p.queue.length) p.toggle()
      else p.playTracks(
        tracks.map((x) => x.id),
        i
      )
    },
    [tracks]
  )

  const onClick = useCallback(
    (e: React.MouseEvent, t: Track, i: number) => {
      setSelected((prev) => {
        if (e.shiftKey && anchor.current >= 0) {
          const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
          return new Set(tracks.slice(a, b + 1).map((x) => x.id))
        }
        if (e.ctrlKey || e.metaKey) {
          const n = new Set(prev)
          n.has(t.id) ? n.delete(t.id) : n.add(t.id)
          anchor.current = i
          return n
        }
        anchor.current = i
        return new Set([t.id])
      })
    },
    [tracks]
  )

  const onMenu = useCallback(
    (e: React.MouseEvent, t: Track) => {
      e.preventDefault()
      e.stopPropagation()
      let targets = tracks.filter((x) => selected.has(x.id))
      if (!selected.has(t.id)) {
        targets = [t]
        setSelected(new Set([t.id]))
      }
      useUI.getState().openMenu(e.clientX, e.clientY, trackMenu(targets, { playlistId }))
    },
    [tracks, selected, playlistId]
  )

  return (
    <div className={`tracklist ${showAlbum ? '' : 'no-album'} ${showDate ? '' : 'no-date'}`} role="table">
      <div className="row head" role="row">
        <div className="c-idx">#</div>
        <div className="c-title">Название</div>
        {showAlbum && <div className="c-album">Альбом</div>}
        {showDate && <div className="c-date">Добавлен</div>}
        <div className="c-q">Качество</div>
        <div className="c-like" />
        <div className="c-time">Время</div>
        <div className="c-more" />
      </div>
      <div
        ref={listRef}
        className="rows"
        style={{ height: tracks.length * rowH, position: 'relative' }}
      >
        {visible.map((i) => {
          const t = tracks[i]
          return (
            <Row
              key={t.id}
              track={t}
              index={i}
              selected={selected.has(t.id)}
              isCurrent={t.id === currentId}
              playing={playing}
              showAlbum={showAlbum}
              showDate={showDate}
              top={i * rowH}
              height={rowH}
              onClick={onClick}
              onDouble={play}
              onMenu={onMenu}
            />
          )
        })}
      </div>
    </div>
  )
}
