import { useEffect, useState } from 'react'
import { engine } from './audio'

/** Текущее время воспроизведения с ограниченной частотой обновления. */
export function useClock(hz = 8): number {
  const [t, setT] = useState(engine.time)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last >= 1000 / hz) {
        last = now
        setT(engine.time)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [hz])
  return t
}

export function useEvent<T extends (...a: any[]) => any>(fn: T): T {
  const [ref] = useState(() => ({ fn }))
  ref.fn = fn
  return ((...a: any[]) => ref.fn(...a)) as T
}
