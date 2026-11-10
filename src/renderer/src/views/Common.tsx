import { Heart, Pause, Play, Shuffle } from 'lucide-react'
import type { Track } from '@shared/types'
import { fmtBytes, fmtDuration, tracksWord } from '@/lib/format'
import { usePlayer } from '@/store/player'
import { Mosaic } from '@/components/Cards'

export function CollectionHeader({
  kind,
  title,
  tracks,
  actions,
  round,
  liked
}: {
  kind: string
  title: string
  tracks: Track[]
  actions?: React.ReactNode
  round?: boolean
  liked?: boolean
}) {
  const total = tracks.reduce((s, t) => s + t.duration, 0)
  const size = tracks.reduce((s, t) => s + t.size, 0)
  const ids = tracks.map((t) => t.id)
  const currentId = usePlayer((s) => s.currentId)
  const playing = usePlayer((s) => s.playing)
  // играет трек из этой коллекции — кнопка работает как пауза/продолжить
  const here = !!currentId && ids.includes(currentId)
  return (
    <div className="coll-head">
      {liked ? (
        <span className="coll-liked"><Heart size={72} fill="currentColor" /></span>
      ) : (
        <Mosaic tracks={tracks} size={196} radius={round ? '50%' : 24} />
      )}
      <div className="coll-info">
        <span className="kind">{kind}</span>
        <h1>{title}</h1>
        <p className="muted">
          {tracksWord(tracks.length)} · {fmtDuration(total)} · {fmtBytes(size)}
        </p>
        <div className="coll-actions">
          <button className="coll-play" disabled={!ids.length} onClick={() => (here ? usePlayer.getState().toggle() : usePlayer.getState().playTracks(ids, 0, { shuffle: false }))} aria-label={here && playing ? 'Пауза' : 'Играть'} title={here && playing ? 'Пауза' : 'Играть'}>
            {here && playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 3 }} />}
          </button>
          <button className="icon-btn coll-shuf" disabled={!ids.length} onClick={() => usePlayer.getState().playTracks(ids, 0, { shuffle: true })} aria-label="Вперемешку" title="Вперемешку">
            <Shuffle size={22} />
          </button>
          {actions}
        </div>
      </div>
    </div>
  )
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden>
        <i /><i /><i /><i /><i />
      </div>
      <h3>{title}</h3>
      <p className="muted">{text}</p>
      {action}
    </div>
  )
}
