import { useEffect, useState } from 'react'
import { ChevronDown, Heart, Pause, Play, Repeat, Repeat1, Scissors, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { trackById } from '@/lib/actions'
import { coverUrl } from '@/lib/format'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { AnalysisPanel } from './AnalysisPanel'
import { AudioPopover } from './AudioPopover'
import { Cover } from './Cover'
import { LyricsView } from './Lyrics'
import { QualityBadge, SeekBar } from './PlayerBar'
import { Slider } from './Slider'
import { SourceBadge } from './SourceBadge'

/** Полноэкранный режим внутри окна приложения: слева трек и управление, справа караоке. */
export function NowPlaying() {
  const open = useUI((s) => s.nowPlaying)
  const setOpen = useUI((s) => s.setNowPlaying)
  const currentId = usePlayer((s) => s.currentId)
  const playing = usePlayer((s) => s.playing)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const audio = useSettings((s) => s.settings.audio)
  const patch = useSettings((s) => s.patch)
  const track = trackById(currentId)
  const [tab, setTab] = useState<'lyrics' | 'analysis'>('lyrics')
  const p = usePlayer.getState

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Escape сначала закрывает открытые окна поверх (аудио, модальные), и только потом сам режим
      if (document.querySelector('.popover, .modal-back')) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null
  const art = coverUrl(track)
  const VolIcon = audio.muted || audio.volume === 0 ? VolumeX : audio.volume < 0.5 ? Volume1 : Volume2
  return (
    <div className="nowplaying" role="dialog" aria-label="Сейчас играет">
      {art && <div key={art} className="np-backdrop" style={{ backgroundImage: `url("${art}")` }} aria-hidden />}
      <div className="np-shade" aria-hidden />
      <div className="np-drag" aria-hidden />
      <button className="np-close icon-btn" onClick={() => setOpen(false)} aria-label="Свернуть" title="Свернуть (Esc)">
        <ChevronDown size={22} />
      </button>
      {track ? (
        <>
          <section className="np-left">
            <div className="np-art">
              <Cover track={track} size="100%" radius={22} className="np-cover" eager />
            </div>
            <div className="np-meta">
              <h1 title={track.title}>{track.title}</h1>
              <p title={track.artist}>
                <SourceBadge kind={track.source.kind} size={15} /> {track.artist}
                {track.album ? ` · ${track.album}` : ''}
              </p>
            </div>
            <div className="np-seek">
              <SeekBar />
            </div>
            <div className="np-controls">
              <button className={`icon-btn ${shuffle ? 'active' : ''}`} onClick={() => p().toggleShuffle()} aria-label="Перемешать"><Shuffle size={19} /></button>
              <button className="icon-btn" onClick={() => p().prev()} aria-label="Предыдущий"><SkipBack size={24} fill="currentColor" /></button>
              <button className="play-btn" onClick={() => p().toggle()} aria-label={playing ? 'Пауза' : 'Играть'}>
                {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 2 }} />}
              </button>
              <button className="icon-btn" onClick={() => p().next()} aria-label="Следующий"><SkipForward size={24} fill="currentColor" /></button>
              <button className={`icon-btn ${repeat !== 'off' ? 'active' : ''}`} onClick={() => p().cycleRepeat()} aria-label="Повтор">
                {repeat === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}
              </button>
            </div>
            <div className="np-tools">
              <button className={`icon-btn like ${track.liked ? 'on' : ''}`} onClick={() => void window.wave.library.like(track.id)} aria-label="В любимые"><Heart size={19} fill={track.liked ? 'currentColor' : 'none'} /></button>
              <div className="volume">
                <button className="icon-btn" onClick={() => patch({ audio: { muted: !audio.muted } })} aria-label="Звук"><VolIcon size={18} /></button>
                <Slider value={audio.muted ? 0 : audio.volume} onChange={(v) => patch({ audio: { volume: v, muted: false } })} aria-label="Громкость" />
              </div>
              <AudioPopover />
              {!track.remote && <button className="icon-btn" title="Вырезать фрагмент" aria-label="Вырезать фрагмент" onClick={() => useUI.getState().openModal({ kind: 'trim', track })}><Scissors size={17} /></button>}
              <QualityBadge id={track.id} withDetail />
            </div>
          </section>
          <section className="np-right">
            <div className="seg np-tabs">
              <button className={tab === 'lyrics' ? 'on' : ''} onClick={() => setTab('lyrics')}>Текст</button>
              <button className={tab === 'analysis' ? 'on' : ''} onClick={() => setTab('analysis')}>Анализ</button>
            </div>
            {tab === 'lyrics' ? <LyricsView track={track} /> : <AnalysisPanel track={track} />}
          </section>
        </>
      ) : (
        <div className="lyrics-empty"><p>Ничего не играет</p></div>
      )}
    </div>
  )
}
