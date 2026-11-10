import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BinariesStatus, ToolStatus } from '@shared/types'
import { binDir } from '../paths'
import { errMsg, fetchJson, fetchText, findInPath, UA } from '../util'

const REPO = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

function assetName(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe'
  if (process.platform === 'darwin') return 'yt-dlp_macos'
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
}

export class Binaries {
  private status: BinariesStatus = { ytdlp: { state: 'missing' }, ffmpeg: { state: 'missing' }, jsRuntime: null }
  onStatus: (s: BinariesStatus) => void = () => {}
  private ensuring: Promise<void> | null = null

  get ytdlpPath(): string {
    return join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  }

  get ffmpegPath(): string | null {
    return this.resolveFfmpeg()
  }

  getStatus(): BinariesStatus {
    return this.status
  }

  private set(patch: Partial<BinariesStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

  private resolveFfmpeg(): string | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      let p = require('ffmpeg-static') as string | null
      if (p) {
        p = p.replace('app.asar', 'app.asar.unpacked')
        if (existsSync(p)) return p
      }
    } catch {
      /* ffmpeg-static не установлен */
    }
    return findInPath('ffmpeg')
  }

  /**
   * Что использовать как JS-рантайм для yt-dlp (нужен для YouTube).
   * Приоритет: Deno/Node из PATH, иначе сам Electron в режиме Node.
   */
  jsRuntime(): { arg: string; env: Record<string, string> } {
    for (const name of ['deno', 'node', 'bun']) {
      const p = findInPath(name)
      if (p) return { arg: `${name}:${p}`, env: {} }
    }
    return { arg: `node:${process.execPath}`, env: { ELECTRON_RUN_AS_NODE: '1' } }
  }

  /** Проверяет/скачивает yt-dlp и находит ffmpeg. Безопасно вызывать многократно. */
  ensure(autoUpdate: boolean): Promise<void> {
    if (!this.ensuring) {
      this.ensuring = this.doEnsure(autoUpdate).finally(() => {
        this.ensuring = null
      })
    }
    return this.ensuring
  }

  private async doEnsure(autoUpdate: boolean): Promise<void> {
    mkdirSync(binDir(), { recursive: true })

    const ff = this.resolveFfmpeg()
    const ffStatus: ToolStatus = ff ? { state: 'ready', path: ff } : { state: 'error', message: 'ffmpeg не найден' }
    this.set({ ffmpeg: ffStatus, jsRuntime: this.jsRuntime().arg })

    try {
      if (!existsSync(this.ytdlpPath)) {
        await this.downloadYtDlp()
      } else {
        const version = await this.version()
        this.set({ ytdlp: { state: 'ready', version, path: this.ytdlpPath } })
        if (autoUpdate && this.shouldCheckUpdate()) {
          await this.updateIfNeeded(version).catch((e) => console.warn('[yt-dlp] проверка обновления:', errMsg(e)))
        }
      }
    } catch (e) {
      this.set({ ytdlp: { state: 'error', message: errMsg(e) } })
    }
  }

  private stampFile(): string {
    return join(binDir(), '.last-update-check')
  }

  private shouldCheckUpdate(): boolean {
    try {
      return Date.now() - Number(readFileSync(this.stampFile(), 'utf8')) > 12 * 3600 * 1000
    } catch {
      return true
    }
  }

  async version(): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ytdlpPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`yt-dlp --version: код ${code}`))))
    })
  }

  private async updateIfNeeded(current: string): Promise<void> {
    const latest = await fetchJson<{ tag_name: string }>('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      timeout: 10000
    })
    writeFileSync(this.stampFile(), String(Date.now()))
    if (latest.tag_name && latest.tag_name !== current) {
      await this.downloadYtDlp()
    }
  }

  /** Принудительное обновление из настроек. */
  async forceUpdate(): Promise<void> {
    await this.downloadYtDlp()
  }

  private async downloadYtDlp(): Promise<void> {
    const name = assetName()
    this.set({ ytdlp: { state: 'downloading', progress: 0 } })
    const res = await fetch(`${REPO}/${name}`, { redirect: 'follow', headers: { 'user-agent': UA } })
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать yt-dlp (HTTP ${res.status})`)

    const total = Number(res.headers.get('content-length')) || 0
    const chunks: Buffer[] = []
    let got = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
      got += value.length
      if (total) this.set({ ytdlp: { state: 'downloading', progress: got / total } })
    }
    const buf = Buffer.concat(chunks)

    // Проверяем контрольную сумму из того же релиза.
    try {
      const sums = await fetchText(`${REPO}/SHA2-256SUMS`, { timeout: 15000 })
      const line = sums.split('\n').find((l) => l.trim().endsWith(` ${name}`) || l.trim().endsWith(`*${name}`))
      const expected = line?.trim().split(/\s+/)[0]
      if (expected) {
        const actual = createHash('sha256').update(buf).digest('hex')
        if (actual !== expected) throw new Error('Контрольная сумма yt-dlp не совпала — файл отброшен')
      }
    } catch (e) {
      if (errMsg(e).includes('Контрольная сумма')) throw e
      console.warn('[yt-dlp] не удалось получить SHA2-256SUMS:', errMsg(e))
    }

    const tmp = `${this.ytdlpPath}.download`
    writeFileSync(tmp, buf)
    if (process.platform !== 'win32') chmodSync(tmp, 0o755)
    rmSync(this.ytdlpPath, { force: true })
    renameSync(tmp, this.ytdlpPath)
    writeFileSync(this.stampFile(), String(Date.now()))

    const version = await this.version()
    this.set({ ytdlp: { state: 'ready', version, path: this.ytdlpPath } })
  }
}
