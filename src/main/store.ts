import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Маленькое JSON-хранилище с отложенной атомарной записью. */
export class JsonStore<T extends object> {
  data: T
  private timer: NodeJS.Timeout | null = null

  constructor(
    private file: string,
    defaults: T,
    private merge: (loaded: unknown, defaults: T) => T = (l, d) => ({ ...d, ...(l as object) })
  ) {
    let loaded: unknown = null
    try {
      if (existsSync(file)) loaded = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      // битый файл — сохраним копию и начнём с чистого листа
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      console.error('[store] не удалось прочитать', file, e)
    }
    this.data = loaded ? this.merge(loaded, defaults) : defaults
  }

  save(delay = 400): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), delay)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch (e) {
      console.error('[store] не удалось записать', this.file, e)
    }
  }
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return (patch === undefined ? base : (patch as T))
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) }
  for (const [k, v] of Object.entries(patch as object)) {
    if (v === undefined || k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    const cur = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = deepMerge(cur, v)
    } else {
      out[k] = v
    }
  }
  return out
}
