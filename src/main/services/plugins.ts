import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginInfo } from '@shared/types'
import { pluginsDir } from '../paths'

const ID = /^[\w.-]+$/

/** Список плагинов: каждая подпапка с plugin.json (необязателен), index.js и/или style.css. */
export function listPlugins(enabled: string[]): PluginInfo[] {
  const root = pluginsDir()
  const out: PluginInfo[] = []
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return out
  }
  for (const id of names) {
    if (!ID.test(id)) continue
    const dir = join(root, id)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'))
    } catch {
      /* метаданные необязательны */
    }
    const hasJs = existsSync(join(dir, 'index.js'))
    const hasCss = existsSync(join(dir, 'style.css'))
    if (!hasJs && !hasCss) continue
    const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : undefined)
    out.push({
      id,
      name: str(meta.name) ?? id,
      version: str(meta.version),
      author: str(meta.author),
      description: str(meta.description),
      hasJs,
      hasCss,
      enabled: enabled.includes(id)
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Кладёт в пустую папку плагинов рабочий пример (выключенный), чтобы было от чего отталкиваться. */
export function ensureExamplePlugin(): void {
  const root = pluginsDir()
  try {
    if (readdirSync(root).length) return
  } catch {
    return
  }
  const dir = join(root, 'example-track-toast')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify(
      {
        name: 'Пример: уведомление о треке',
        version: '1.0.0',
        author: 'Wave',
        description: 'Показывает всплывающее сообщение при смене трека. Смотрите index.js — это шаблон для своих плагинов.'
      },
      null,
      2
    )
  )
  writeFileSync(
    join(dir, 'index.js'),
    `// Плагин получает глобальный объект Wave (то же самое: window.WaveAPI).
// Документация: Настройки → Расширения.
(function (Wave) {
  let last = null
  const off = Wave.player.subscribe(function (s) {
    if (s.currentId && s.currentId !== last) {
      last = s.currentId
      const t = Wave.library.getTrack(s.currentId)
      if (t) Wave.ui.toast('Играет: ' + t.artist + ' — ' + t.title, 'info')
    }
  })
  // Wave.css(text) добавляет стили и возвращает функцию удаления
})(window.WaveAPI)
`
  )
}
