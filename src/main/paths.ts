import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export const dataDir = () => app.getPath('userData')
export const binDir = () => join(dataDir(), 'bin')
export const coversDir = () => join(dataDir(), 'covers')
export const lyricsDir = () => join(dataDir(), 'lyrics')
export const tmpDir = () => join(dataDir(), 'tmp')
export const backgroundsDir = () => join(dataDir(), 'backgrounds')
export const analysisDir = () => join(dataDir(), 'analysis')
export const pluginsDir = () => join(dataDir(), 'plugins')
export const defaultMusicDir = () => join(app.getPath('music'), 'Wave')

export function ensureDirs(): void {
  for (const d of [dataDir(), binDir(), coversDir(), lyricsDir(), tmpDir(), backgroundsDir(), pluginsDir(), analysisDir()]) {
    mkdirSync(d, { recursive: true })
  }
}
