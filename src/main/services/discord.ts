import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { PresenceInfo, PresenceStatus } from '@shared/types'

// Discord Rich Presence по локальному IPC (сокет/именованный канал клиента Discord) — без сторонних библиотек.
// Формат активности (type 2 «Слушает», отображение исполнителя в статусе, кнопка «Listen», переподключение раз в 15 с)
// взят из модуля discord.js проекта Riff (rootscripts/riff, MIT) — см. THIRD_PARTY_NOTICES.md.
// Ничего не отправляется в сеть самим Wave: данные получает только локально запущенный клиент Discord.

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const
const RECONNECT_MS = 15_000
const MIN_GAP_MS = 1500 // Discord ограничивает частоту обновления активности

function encode(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

/** Где искать сокет клиента Discord (обычный, Snap, Flatpak, Windows). */
export function ipcPaths(): string[] {
  const out: string[] = []
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') {
      out.push(`\\\\?\\pipe\\discord-ipc-${i}`)
      continue
    }
    const base = process.env['XDG_RUNTIME_DIR'] || process.env['TMPDIR'] || process.env['TMP'] || process.env['TEMP'] || '/tmp'
    out.push(join(base, `discord-ipc-${i}`), join(base, 'snap.discord', `discord-ipc-${i}`), join(base, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`))
  }
  return out
}

function tryConnect(path: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const s = connect(path)
    const fail = () => {
      s.destroy()
      resolve(null)
    }
    s.once('error', fail)
    s.once('connect', () => {
      s.removeListener('error', fail)
      resolve(s)
    })
    s.setTimeout(2000, fail)
  })
}

export class DiscordPresence {
  private sock: Socket | null = null
  private ready = false
  private connecting = false
  private buf = Buffer.alloc(0)
  private pending = new Map<string, (msg: any) => void>()
  private info: PresenceInfo | null = null
  private lastError = ''
  private timer: NodeJS.Timeout | null = null
  private reconnect: NodeJS.Timeout | null = null
  private lastSent = 0
  private destroyed = false

  constructor(
    private cfg: () => { enabled: boolean; clientId: string },
    /** путь к сокетам можно подменить (тесты) */
    private paths: () => string[] = ipcPaths
  ) {}

  private get active(): boolean {
    const c = this.cfg()
    return c.enabled && /^\d{15,25}$/.test(c.clientId) && !this.destroyed
  }

  status(): PresenceStatus {
    const c = this.cfg()
    return { enabled: c.enabled, configured: /^\d{15,25}$/.test(c.clientId), connected: this.ready, error: this.lastError || undefined }
  }

  /** Новое состояние плеера. null или пауза — убрать статус. */
  update(info: PresenceInfo | null): void {
    this.info = info && info.playing ? info : null
    if (!this.active) return
    if (!this.ready) return void this.ensureConnected()
    this.schedule()
  }

  /** Настройки изменились (включили/выключили, сменили ID). */
  configChanged(): void {
    if (!this.active) {
      // сначала дожидаемся, пока Discord примет «очистить статус», и только потом закрываем соединение
      const s = this.sock
      void this.clear().finally(() => {
        if (this.sock === s) this.disconnect()
      })
      return
    }
    // ID мог измениться — переподключаемся с новым
    this.disconnect()
    this.ensureConnected()
  }

  stop(): void {
    this.destroyed = true
    // на выходе из приложения ждём очистки не дольше секунды
    void Promise.race([this.clear(), new Promise((r) => setTimeout(r, 1000))]).finally(() => this.disconnect())
  }

  private schedule(): void {
    if (this.timer) return
    const wait = Math.max(0, this.lastSent + MIN_GAP_MS - Date.now())
    this.timer = setTimeout(() => {
      this.timer = null
      void this.push()
    }, wait)
  }

  private async push(): Promise<void> {
    if (!this.ready) return
    this.lastSent = Date.now()
    if (!this.info) return void this.clear()
    const i = this.info
    const nowSec = Math.floor(Date.now() / 1000)
    const start = nowSec - Math.max(0, Math.floor(i.position))
    const pad = (s: string) => s.slice(0, 128).padEnd(2, ' ')
    const activity: Record<string, unknown> = {
      type: 2,
      details: pad(i.title || 'Unknown Track'),
      state: pad(i.artist || 'Unknown Artist'),
      timestamps: { start, ...(i.duration > 0 ? { end: start + Math.floor(i.duration) } : {}) },
      instance: false
    }
    if (i.url && /^https:\/\//.test(i.url) && i.url.length <= 512) activity['buttons'] = [{ label: 'Listen', url: i.url }]
    // «status_display_type: 1» — показывать исполнителя в статусе; старые клиенты поле не знают, тогда повторяем без него
    const res = await this.request('SET_ACTIVITY', { pid: process.pid, activity: { ...activity, status_display_type: 1 } })
    if (res?.evt === 'ERROR') {
      const retry = await this.request('SET_ACTIVITY', { pid: process.pid, activity })
      this.lastError = retry?.evt === 'ERROR' ? String(retry.data?.message ?? 'Discord отклонил статус') : ''
    } else this.lastError = ''
  }

  private async clear(): Promise<void> {
    if (this.ready) await this.request('SET_ACTIVITY', { pid: process.pid })
  }

  private request(cmd: string, args: unknown): Promise<any> {
    return new Promise((resolve) => {
      if (!this.sock || !this.ready) return resolve(null)
      const nonce = randomUUID()
      const t = setTimeout(() => {
        this.pending.delete(nonce)
        resolve(null)
      }, 5000)
      this.pending.set(nonce, (m) => {
        clearTimeout(t)
        resolve(m)
      })
      this.sock.write(encode(OP.FRAME, { cmd, args, nonce }))
    })
  }

  private ensureConnected(): void {
    if (this.ready || this.connecting || this.reconnect || !this.active) return
    void this.open()
  }

  private async open(): Promise<void> {
    this.connecting = true
    try {
      let sock: Socket | null = null
      for (const p of this.paths()) {
        sock = await tryConnect(p)
        if (sock) break
      }
      if (!sock) {
        this.lastError = 'Клиент Discord не запущен (или его сокет недоступен)'
        return this.retryLater()
      }
      sock.setTimeout(0)
      this.sock = sock
      this.buf = Buffer.alloc(0)
      sock.on('data', (d) => this.onData(d))
      sock.on('close', () => this.onClose())
      sock.on('error', () => {})
      sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.cfg().clientId }))
    } finally {
      this.connecting = false
    }
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d])
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0)
      const len = this.buf.readInt32LE(4)
      if (len < 0 || len > 1 << 20) return void this.sock?.destroy() // мусор в потоке
      if (this.buf.length < 8 + len) return
      const body = this.buf.subarray(8, 8 + len).toString('utf8')
      this.buf = this.buf.subarray(8 + len)
      let msg: any = null
      try {
        msg = JSON.parse(body)
      } catch {
        /* пропускаем */
      }
      if (op === OP.PING) this.sock?.write(encode(OP.PONG, msg ?? {}))
      else if (op === OP.CLOSE) {
        this.lastError = String(msg?.message ?? 'Discord закрыл соединение')
        this.sock?.destroy()
      } else if (msg?.evt === 'READY') {
        this.ready = true
        this.lastError = ''
        if (this.info) this.schedule()
      } else if (msg?.nonce && this.pending.has(msg.nonce)) {
        this.pending.get(msg.nonce)!(msg)
        this.pending.delete(msg.nonce)
      }
    }
  }

  private onClose(): void {
    this.ready = false
    this.sock = null
    for (const cb of this.pending.values()) cb(null)
    this.pending.clear()
    if (this.active) this.retryLater()
  }

  private retryLater(): void {
    if (this.reconnect || !this.active) return
    this.reconnect = setTimeout(() => {
      this.reconnect = null
      this.ensureConnected()
    }, RECONNECT_MS)
    this.reconnect.unref?.()
  }

  private disconnect(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.reconnect) clearTimeout(this.reconnect)
    this.timer = this.reconnect = null
    const s = this.sock
    this.sock = null
    this.ready = false
    s?.removeAllListeners('close')
    s?.destroy()
  }
}
