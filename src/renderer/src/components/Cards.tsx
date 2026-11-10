import { Play } from 'lucide-react'
import type { Track } from '@shared/types'
import { Cover } from './Cover'

export function Mosaic({ tracks, size, radius }: { tracks: Track[]; size: number | string; radius?: number | string }) {
  const withCover = tracks.filter((t) => t.hasCover)
  const uniq: Track[] = []
  const seen = new Set<string>()
  for (const t of withCover) {
    const k = t.album ?? t.id
    if (!seen.has(k)) {
      seen.add(k)
      uniq.push(t)
    }
  }
  if (uniq.length < 4) return <Cover track={uniq[0] ?? tracks[0]} size={size} radius={radius} />
  return (
    <div className="mosaic" style={{ width: size, height: size, borderRadius: typeof radius === 'number' && radius > 0 ? `calc(${radius}px * var(--cover-k, 1))` : radius }}>
      {uniq.slice(0, 4).map((t) => (
        <Cover key={t.id} track={t} size="100%" radius={0} />
      ))}
    </div>
  )
}

export function Card({ tracks, title, subtitle, round, onOpen, onPlay }: { tracks: Track[]; title: string; subtitle: string; round?: boolean; onOpen: () => void; onPlay: () => void }) {
  return (
    <div className="card" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className={`card-art ${round ? 'round' : ''}`}>
        <Mosaic tracks={tracks} size="100%" radius={round ? '50%' : 'calc(var(--radius) * var(--cover-k, 1))'} />
        <button
          className="card-play"
          onClick={(e) => {
            e.stopPropagation()
            onPlay()
          }}
          aria-label="Играть"
        >
          <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />
        </button>
      </div>
      <div className="card-t1" title={title}>{title}</div>
      <div className="card-t2">{subtitle}</div>
    </div>
  )
}
