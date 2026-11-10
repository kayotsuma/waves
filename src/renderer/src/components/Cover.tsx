import { useState } from 'react'
import { Music } from 'lucide-react'
import type { Track } from '@shared/types'
import { coverUrl, hashHue } from '@/lib/format'

interface Props {
  track?: Pick<Track, 'id' | 'hasCover' | 'coverRev' | 'album' | 'title'> | null
  size?: number | string
  radius?: number | string
  className?: string
  eager?: boolean
}

export function Cover({ track, size = 48, radius, className = '', eager }: Props) {
  const url = coverUrl(track)
  // если файл обложки пропал — показываем градиент вместо «битой» картинки
  const [failed, setFailed] = useState<string | null>(null)
  const hue = hashHue(track?.album || track?.title || 'x')
  // числовое скругление масштабируется настройкой «Скругление обложек» (--cover-k)
  const r = typeof radius === 'number' && radius > 0 ? `calc(${radius}px * var(--cover-k, 1))` : radius
  const style: React.CSSProperties = { width: size, height: size, ...(r !== undefined ? { borderRadius: r } : {}) }
  return (
    <div className={`cover ${className}`} style={style}>
      {url && failed !== url ? (
        <img src={url} alt="" draggable={false} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(url)} />
      ) : (
        <div className="cover-fallback" style={{ ['--h' as string]: hue }}>
          <Music size={typeof size === 'number' ? Math.max(14, size * 0.38) : 24} strokeWidth={1.75} />
        </div>
      )}
    </div>
  )
}
