import type { LyricLine, LyricWord } from '@shared/types'

const TS = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const WORD_TS = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g

function toSeconds(m: string, s: string, f?: string): number {
  const frac = f ? Number(`0.${f}`) : 0
  return Number(m) * 60 + Number(s) + frac
}

export function looksLikeLrc(text: string): boolean {
  return /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(text)
}

/** Разбирает LRC (в т.ч. «enhanced» с пословными метками <mm:ss.xx>). */
export function parseLrc(text: string): { lines: LyricLine[]; offset: number } {
  const lines: LyricLine[] = []
  let offset = 0

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i)
    if (off) {
      offset = Number(off[1]) / 1000
      continue
    }
    const times: number[] = []
    TS.lastIndex = 0
    let m: RegExpExecArray | null
    let lastEnd = 0
    while ((m = TS.exec(raw)) && m.index === lastEnd) {
      times.push(toSeconds(m[1], m[2], m[3]))
      lastEnd = TS.lastIndex
    }
    if (!times.length) continue
    const body = raw.slice(lastEnd)

    let words: LyricWord[] | undefined
    let textOnly = body.trim()
    if (WORD_TS.test(body)) {
      WORD_TS.lastIndex = 0
      const parts: LyricWord[] = []
      let pos = 0
      let curT: number | null = null
      let wm: RegExpExecArray | null
      while ((wm = WORD_TS.exec(body))) {
        const chunk = body.slice(pos, wm.index)
        if (curT !== null && chunk.trim()) parts.push({ t: curT, text: chunk })
        curT = toSeconds(wm[1], wm[2], wm[3])
        pos = WORD_TS.lastIndex
      }
      const tail = body.slice(pos)
      if (curT !== null && tail.trim()) parts.push({ t: curT, text: tail })
      if (parts.length) {
        words = parts
        textOnly = parts.map((p) => p.text).join('').replace(/\s+/g, ' ').trim()
      } else {
        textOnly = body.replace(WORD_TS, '').trim()
      }
    }
    for (const t of times) lines.push({ t, text: textOnly, ...(words ? { words } : {}) })
  }

  lines.sort((a, b) => a.t - b.t)
  // схлопываем подряд идущие пустые строки
  const out: LyricLine[] = []
  for (const l of lines) {
    if (!l.text && out.length && !out[out.length - 1].text) continue
    out.push(l)
  }
  return { lines: out, offset }
}

export function stringifyLrc(lines: LyricLine[], offset = 0): string {
  const f = (t: number) => {
    const total = Math.max(0, t)
    const m = Math.floor(total / 60)
    const s = total - m * 60
    return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`
  }
  const head = offset ? `[offset:${Math.round(offset * 1000)}]\n` : ''
  return head + lines.map((l) => `${f(l.t)}${l.text}`).join('\n') + '\n'
}
