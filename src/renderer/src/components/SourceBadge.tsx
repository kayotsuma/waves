import { Cloud, Disc3, HardDrive, Headphones, Link2, Music2, CirclePlay } from 'lucide-react'
import type { SourceKind } from '@shared/types'

export const SOURCE_INFO: Record<SourceKind, { label: string; color: string; Icon: typeof CirclePlay }> = {
  youtube: { label: 'YouTube', color: '#ff3b3b', Icon: CirclePlay },
  soundcloud: { label: 'SoundCloud', color: '#ff7a1a', Icon: Cloud },
  spotify: { label: 'Spotify', color: '#1ed760', Icon: Music2 },
  apple: { label: 'Apple Music', color: '#fa5c7c', Icon: Music2 },
  deezer: { label: 'Deezer', color: '#a238ff', Icon: Headphones },
  yandex: { label: 'Яндекс Музыка', color: '#ffcc00', Icon: Disc3 },
  local: { label: 'Мой файл', color: '#8e9bb3', Icon: HardDrive },
  other: { label: 'Ссылка', color: '#8e9bb3', Icon: Link2 }
}

/** Маленький значок источника трека (как в Riff). */
export function SourceBadge({ kind, size = 14, withLabel }: { kind: SourceKind; size?: number; withLabel?: boolean }) {
  const s = SOURCE_INFO[kind] ?? SOURCE_INFO.other
  return (
    <span className="src-badge" title={s.label} style={{ color: s.color }}>
      <s.Icon size={size} strokeWidth={2.2} />
      {withLabel && <b>{s.label}</b>}
    </span>
  )
}
