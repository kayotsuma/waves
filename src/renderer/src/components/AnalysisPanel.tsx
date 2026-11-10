import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { SimilarTrack, Track } from '@shared/types'
import { NOTE_NAMES } from '@/lib/music'
import { fmtTime } from '@/lib/format'
import { trackById } from '@/lib/actions'
import { useAnalysis } from '@/store/analysis'
import { usePlayer } from '@/store/player'
import { Cover } from './Cover'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="an-stat">
      <span className="an-label">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="an-meter">
      <span>{label}</span>
      <div className="an-bar">
        <i style={{ width: `${value}%` }} />
      </div>
      <span className="val">{value}</span>
    </div>
  )
}

/** Карточка анализа трека: темп, тональность, громкость, динамика, характер звучания и похожие треки. */
export function AnalysisPanel({ track }: { track: Track }) {
  const { data, loading } = useAnalysis(track.id)
  const [similar, setSimilar] = useState<SimilarTrack[]>([])

  useEffect(() => {
    setSimilar([])
    if (!data) return
    let alive = true
    void window.wave.analysis.similar(track.id, 8).then((r) => alive && setSimilar(r))
    return () => {
      alive = false
    }
  }, [track.id, data])

  if (loading || (!data && !track.missing)) {
    return (
      <div className="an-empty">
        <Loader2 className="spin" size={22} />
        <p>Анализирую трек… это займёт несколько секунд.</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="an-empty">
        <p>Для этого трека анализ недоступен: файл не найден, он слишком длинный (больше 30 минут) или в нём нет звука.</p>
      </div>
    )
  }

  const key = data.key
  const keyName = key ? `${NOTE_NAMES[key.tonic]} ${key.mode === 'major' ? 'мажор' : 'минор'}` : '—'
  const play = (id: string) => usePlayer.getState().playTracks([id])

  return (
    <div className="analysis">
      <h3>Анализ трека</h3>
      <div className="an-stats">
        <Stat label="Темп" value={data.bpm ? `${Math.round(data.bpm)} BPM` : '—'} sub={data.bpmConfidence != null ? `уверенность ${Math.round(data.bpmConfidence * 100)}%` : undefined} />
        <Stat label="Тональность" value={keyName} sub={key ? `Camelot ${key.camelot}` : undefined} />
        <Stat label="Длительность" value={fmtTime(track.duration)} />
        <Stat label="Громкость" value={data.loudness != null ? `${data.loudness.toFixed(1)} LUFS` : '—'} sub={data.peak != null ? `пик ${data.peak.toFixed(1)} дБFS` : undefined} />
        <Stat label="Динамика" value={data.dynamics != null ? `${data.dynamics.toFixed(1)} дБ` : '—'} sub={data.dynamics != null ? (data.dynamics < 8 ? 'сильно сжато' : data.dynamics < 12 ? 'умеренно' : 'живая запись') : undefined} />
      </div>

      <h4>Характер звучания</h4>
      <div className="an-meters">
        <Meter label="Энергия" value={data.energy} />
        <Meter label="Бас" value={data.bass} />
        <Meter label="Вокал" value={data.vocal} />
        <Meter label="Яркость" value={data.brightness} />
      </div>

      <h4>Похожие в медиатеке</h4>
      {similar.length === 0 ? (
        <p className="muted">Пока не с чем сравнить: треки анализируются в фоне, список пополнится по мере готовности.</p>
      ) : (
        <div className="an-similar">
          {similar.map((s) => {
            const t = trackById(s.trackId)
            if (!t) return null
            return (
              <button key={s.trackId} className="an-sim" onClick={() => play(s.trackId)} title="Играть">
                <Cover track={t} size={36} radius={6} />
                <span className="txt">
                  <span className="t1">{t.title}</span>
                  <span className="t2">{t.artist}</span>
                </span>
                <span className="pct">{s.score}%</span>
              </button>
            )
          })}
        </div>
      )}
      <p className="hint">Анализ считается на вашем компьютере. Темп и тональность — оценка: на ambient, речи и нестандартных размерах они бывают неточными, а темп иногда определяется вдвое выше или ниже.</p>
    </div>
  )
}
