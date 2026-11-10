import { useState } from 'react'
import {
  Heart,
  ListMusic,
  Mic2,
  PanelRight,
  Pause,
  PencilLine,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { fmtBytes, fmtTime, quality } from '@/lib/format'
import { useClock } from '@/lib/hooks'
import { trackById } from '@/lib/actions'
import { usePlayer } from '@/store/player'
import { useAnalysis } from '@/store/analysis'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { AudioPopover } from './AudioPopover'
import { Cover } from './Cover'
import { SourceBadge } from './SourceBadge'
import { Slider } from './Slider'
import { SquigglySeek } from './SquigglySeek'
import { WaveSeek } from './WaveSeek'

export function QualityBadge({ id, withDetail }: { id: string; withDetail?: boolean }) {
  const t = trackById(id)
  if (!t) return null
  const q = quality(t)
  const tip = [
    q.label + (q.detail ? ` · ${q.detail}` : ''),
    t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)} кГц` : '',
    t.loudness != null ? `громкость ${t.loudness.toFixed(1)} LUFS` : '',
    fmtBytes(t.size)
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span className={`qbadge ${q.tier}`} title={tip}>
      {q.label}
      {withDetail && q.detail && <small>{q.detail.replace(' kbps', 'k')}</small>}
    </span>
  )
}

export function SeekBar() {
  const duration = usePlayer((s) => s.duration)
  const seek = usePlayer((s) => s.seek)
  const currentId = usePlayer((s) => s.currentId)
  const style = useSettings((s) => s.settings.appearance.seekStyle)
  const playing = usePlayer((s) => s.playing)
  const { data } = useAnalysis(style === 'waveform' ? currentId : null)
  const time = useClock(10)
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? time
  const commit = (v: number) => {
    seek(v)
    setDrag(null)
  }
  return (
    <div className="seek">
      <span className="time">{fmtTime(shown)}</span>
      {style === 'squiggly' ? (
        <SquigglySeek value={Math.min(shown, duration || 0)} duration={duration} playing={playing} onChange={setDrag} onCommit={commit} />
      ) : style === 'waveform' && data?.peaks.length && duration ? (
        <WaveSeek peaks={data.peaks} value={Math.min(shown, duration)} duration={duration} onChange={setDrag} onCommit={commit} />
      ) : (
      <Slider
        className="seek-slider"
        value={Math.min(shown, duration || 0)}
        max={duration || 1}
        step={0.1}
        onChange={setDrag}
        onCommit={commit}
        aria-label="Позиция"
        disabled={!duration}
      />
      )}
      <span className="time">{fmtTime(duration)}</span>
    </div>
  )
}

export function PlayerBar() {
  const currentId = usePlayer((s) => s.currentId)
  const playing = usePlayer((s) => s.playing)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const p = usePlayer.getState
  const track = trackById(currentId)
  const audio = useSettings((s) => s.settings.audio)
  const patch = useSettings((s) => s.patch)
  const ui = useUI()

  const VolIcon = audio.muted || audio.volume === 0 ? VolumeX : audio.volume < 0.5 ? Volume1 : Volume2

  return (
    <footer className="playerbar glass">
      <div className="pb-left">
        {track ? (
          <>
            <button className="pb-cover" onClick={() => ui.setInfoOpen(!ui.infoOpen)} title="Панель «Сейчас играет»">
              <Cover track={track} size={56} radius={12} eager />
            </button>
            <div className="pb-meta">
              <div className="t1" title={track.title}>{track.title}</div>
              <div className="t2" title={track.artist}><SourceBadge kind={track.source.kind} size={13} /> <span>{track.artist}</span></div>
            </div>
            <div className="pb-acts">
              <button className={`icon-btn like ${track.liked ? 'on' : ''}`} onClick={() => void window.wave.library.like(track.id)} aria-label="В любимые" title="В любимые">
                <Heart size={18} fill={track.liked ? 'currentColor' : 'none'} />
              </button>
              <button className="icon-btn" onClick={() => ui.openModal({ kind: 'edit-track', track })} aria-label="Изменить данные" title="Изменить данные"><PencilLine size={17} /></button>
              {track.source.url && /^https?:/.test(track.source.url) && (
                <button
                  className="icon-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(track.source.url!).then(() => ui.toast('Ссылка на источник скопирована', 'success'))
                  }}
                  aria-label="Скопировать ссылку"
                  title="Скопировать ссылку на источник"
                >
                  <Share2 size={17} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="pb-meta idle">
            <div className="t1">Ничего не играет</div>
            <div className="t2">Выберите трек или добавьте музыку по ссылке</div>
          </div>
        )}
      </div>

      <div className="pb-center">
        <div className="controls">
          <button className={`icon-btn ${shuffle ? 'active' : ''}`} onClick={() => p().toggleShuffle()} title="Перемешать" aria-label="Перемешать">
            <Shuffle size={17} />
          </button>
          <button className="icon-btn" onClick={() => p().prev()} title="Предыдущий" aria-label="Предыдущий">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button className="play-btn" onClick={() => p().toggle()} title={playing ? 'Пауза (Пробел)' : 'Играть (Пробел)'} aria-label={playing ? 'Пауза' : 'Играть'}>
            {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />}
          </button>
          <button className="icon-btn" onClick={() => p().next()} title="Следующий" aria-label="Следующий">
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button className={`icon-btn ${repeat !== 'off' ? 'active' : ''}`} onClick={() => p().cycleRepeat()} title={`Повтор: ${repeat === 'off' ? 'выкл' : repeat === 'all' ? 'все' : 'трек'}`} aria-label="Повтор">
            {repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>
        <SeekBar />
      </div>

      <div className="pb-right">
        {currentId && <QualityBadge id={currentId} withDetail />}
        <button className="icon-btn" onClick={() => ui.showQueue()} title="Очередь" aria-label="Очередь">
          <ListMusic size={18} />
        </button>
        <button className={`icon-btn ${ui.nowPlaying ? 'active' : ''}`} onClick={() => ui.setNowPlaying(!ui.nowPlaying)} title="Текст / караоке" aria-label="Караоке">
          <Mic2 size={18} />
        </button>
        <button className={`icon-btn ${ui.infoOpen ? 'active' : ''}`} onClick={() => ui.setInfoOpen(!ui.infoOpen)} title="Панель «Сейчас играет»" aria-label="Панель Сейчас играет">
          <PanelRight size={18} />
        </button>
        <AudioPopover />
        <div className="volume">
          <button className="icon-btn" onClick={() => patch({ audio: { muted: !audio.muted } })} aria-label="Звук">
            <VolIcon size={18} />
          </button>
          <Slider value={audio.muted ? 0 : audio.volume} onChange={(v) => patch({ audio: { volume: v, muted: false } })} aria-label="Громкость" />
        </div>
      </div>
    </footer>
  )
}
