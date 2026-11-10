import { useEffect } from 'react'
import { create } from 'zustand'
import type { TrackAnalysis } from '@shared/types'

interface AnalysisState {
  /** undefined — ещё не запрашивали, null — проанализировать нельзя */
  byId: Record<string, TrackAnalysis | null>
  pending: Record<string, true>
  load: (id: string) => void
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  byId: {},
  pending: {},
  load: (id) => {
    const s = get()
    if (id in s.byId || s.pending[id]) return
    set({ pending: { ...s.pending, [id]: true } })
    window.wave.analysis
      .get(id)
      .catch(() => null)
      .then((a) => {
        const { pending, byId } = get()
        const { [id]: _done, ...rest } = pending
        set({ byId: { ...byId, [id]: a }, pending: rest })
      })
  }
}))

/** Анализ трека (волна, темп, тональность…). Первое обращение запускает расчёт — это занимает пару секунд. */
export function useAnalysis(id: string | null): { data: TrackAnalysis | null; loading: boolean } {
  const load = useAnalysisStore((s) => s.load)
  const data = useAnalysisStore((s) => (id ? s.byId[id] : undefined))
  const loading = useAnalysisStore((s) => (id ? !!s.pending[id] : false))
  useEffect(() => {
    if (id) load(id)
  }, [id, load])
  return { data: data ?? null, loading }
}
