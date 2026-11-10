import { ExternalLink, Heart, ListPlus, Mic2, X } from 'lucide-react'
import { trackById } from '@/lib/actions'
import { fmtBytes, tracksWord } from '@/lib/format'
import { useAnalysis } from '@/store/analysis'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUI } from '@/store/ui'
import { Cover } from './Cover'
import { SOURCE_INFO, SourceBadge } from './SourceBadge'

/** Правая панель «Сейчас играет»: обложка, авторы, источник звука и анализ трека (как в Riff). */
export function InfoPanel() {
  const open = useUI((s) => s.infoOpen)
  const setOpen = useUI((s) => s.setInfoOpen)
  const navigate = useUI((s) => s.navigate)
  const openModal = useUI((s) => s.openModal)
  const setNowPlaying = useUI((s) => s.setNowPlaying)
  const currentId = usePlayer((s) => s.currentId)
  const tracks = useLibrary((s) => s.tracks)
  const track = trackById(currentId)
  const { data } = useAnalysis(track ? track.id : null)
  if (!open) return null

  const artists = track ? (track.artists.length ? track.artists : [track.artist]) : []
  const link = track?.source.url && /^https?:/.test(track.source.url) ? track.source.url : null
  const count = (a: string) => tracks.filter((t) => (t.artists.length ? t.artists : [t.artist]).includes(a)).length

  return (
    <aside className="info-panel">
      <header>
        <h4>Сейчас играет</h4>
        <button className="icon-btn sm" onClick={() => setOpen(false)} aria-label="Закрыть панель"><X size={17} /></button>
      </header>
      {!track ? (
        <div className="info-empty">
          <div className="info-ph" />
          <p className="muted">Выберите трек — здесь появятся обложка, сведения об исполнителе и анализ звучания.</p>
        </div>
      ) : (
        <div className="info-scroll">
          <div className="info-cover"><Cover track={track} size="100%" radius={20} eager /></div>
          <div className="info-title">
            <div className="txt">
              <h3 title={track.title}>{track.title}</h3>
              <p title={track.artist}>{track.artist}</p>
            </div>
            <button className="icon-btn" onClick={() => openModal({ kind: 'pick-playlist', trackIds: [track.id] })} aria-label="В плейлист" title="В плейлист"><ListPlus size={19} /></button>
            <button className={`icon-btn like ${track.liked ? 'on' : ''}`} onClick={() => void window.wave.library.like(track.id)} aria-label="В любимые"><Heart size={19} fill={track.liked ? 'currentColor' : 'none'} /></button>
          </div>

          <section className="info-card">
            <h5>Авторы</h5>
            {artists.map((a, i) => (
              <button key={a} className="credit" onClick={() => navigate({ name: 'artist', key: a })}>
                <span className="txt"><b>{a}</b><small>{i === 0 ? 'Исполнитель' : 'Участник'} · {tracksWord(count(a))} в медиатеке</small></span>
              </button>
            ))}
            {track.album && (
              <button className="credit" onClick={() => navigate({ name: 'album', key: `${track.album}\u0001${artists[0]}` })}>
                <span className="txt"><b>{track.album}</b><small>Альбом{track.year ? ` · ${track.year}` : ''}</small></span>
              </button>
            )}
          </section>

          {data && (data.bpm || data.key) && (
            <section className="info-card">
              <h5>Звучание</h5>
              <div className="info-chips">
                {data.bpm ? <span className="chip on">{Math.round(data.bpm)} BPM</span> : null}
                {data.key ? <span className="chip on">{data.key.camelot}</span> : null}
                {data.loudness != null ? <span className="chip">{data.loudness.toFixed(1)} LUFS</span> : null}
                <span className="chip">энергия {Math.round(data.energy)}</span>
              </div>
            </section>
          )}

          <section className="info-card">
            <h5>Источник звука</h5>
            <div className="credit static">
              <SourceBadge kind={track.source.kind} size={20} />
              <span className="txt"><b>{SOURCE_INFO[track.source.kind]?.label ?? 'Ссылка'}</b><small>{fmtBytes(track.size)}</small></span>
              {link && <button className="icon-btn sm" onClick={() => void window.wave.app.openExternal(link)} aria-label="Открыть источник" title="Открыть источник"><ExternalLink size={16} /></button>}
            </div>
            <button className="btn tonal sm info-lyrics" onClick={() => setNowPlaying(true)}><Mic2 size={16} /> Текст и караоке</button>
          </section>
        </div>
      )}
    </aside>
  )
}
