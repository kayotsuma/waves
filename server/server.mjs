#!/usr/bin/env node
// Сервер аккаунтов и синхронизации Wave. Один файл, без зависимостей (Node ≥ 20).
//
//   node server/server.mjs
//
// Переменные окружения:
//   PORT=8787                  порт
//   HOST=127.0.0.1             адрес. Для доступа из сети — 0.0.0.0, но ТОЛЬКО за HTTPS-прокси (Caddy, nginx):
//                              сам сервер говорит по HTTP, а пароль нельзя гонять по сети открытым текстом
//   WAVE_SERVER_DATA=./data    где хранить пользователей и их данные
//   WAVE_ALLOW_REGISTER=1      0 — запретить регистрацию новых пользователей (когда свои аккаунты уже созданы)
//
// Хранится только описание библиотеки (названия, плейлисты, «любимое», настройки), но не аудиофайлы и не токены сервисов,
// и витрины профилей тех, кто решил их показать (видны только пользователям этого сервера).

import http from 'node:http'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const DATA = resolve(process.env.WAVE_SERVER_DATA || './data')
const ALLOW_REGISTER = process.env.WAVE_ALLOW_REGISTER !== '0'
const MAX_BODY = 8 * 1024 * 1024
const SESSION_DAYS = 60

mkdirSync(join(DATA, 'docs'), { recursive: true })
mkdirSync(join(DATA, 'profiles'), { recursive: true })

// ───── хранилище ─────

function readJson(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
  } catch (e) {
    console.error('Не удалось прочитать', file, e)
    throw e // лучше упасть, чем затереть данные пустым файлом
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
  renameSync(tmp, file)
}

const usersFile = join(DATA, 'users.json')
const db = readJson(usersFile, { users: {}, sessions: {} })
const saveDb = () => writeJson(usersFile, db)
const docFile = (userId) => join(DATA, 'docs', `${userId}.json`)
const profileFile = (userId) => join(DATA, 'profiles', `${userId}.json`)
const MAX_PROFILE = 7 * 1024 * 1024

const sha = (s) => createHash('sha256').update(s).digest('hex')

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
}

function verifyPassword(password, user) {
  // для несуществующего пользователя считаем хэш всё равно — чтобы по времени нельзя было перебирать имена
  const salt = user?.salt ?? 'x'.repeat(32)
  const got = Buffer.from(hashPassword(password, salt), 'hex')
  const want = Buffer.from(user?.hash ?? '0'.repeat(128), 'hex')
  return !!user && got.length === want.length && timingSafeEqual(got, want)
}

function pruneSessions() {
  const now = Date.now()
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[k]
}

function newSession(userId) {
  pruneSessions()
  const token = randomBytes(32).toString('base64url')
  db.sessions[sha(token)] = { userId, exp: Date.now() + SESSION_DAYS * 86400_000 }
  saveDb()
  return token
}

// ───── ограничение частоты ─────

const buckets = new Map()
function limited(key, max, windowMs) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs })
    return false
  }
  b.n++
  return b.n > max
}
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k)
}, 60_000).unref()

// ───── HTTP ─────

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Слишком большой запрос'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new HttpError(400, 'Некорректный JSON'))
      }
    })
    req.on('error', reject)
  })
}

function auth(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
  const s = m && db.sessions[sha(m[1])]
  if (!s || s.exp < Date.now()) throw new HttpError(401, 'Нужно войти заново')
  return s.userId
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const validDoc = (d) => isObj(d) && d.v === 1 && isObj(d.tracks) && isObj(d.playlists) && isObj(d.removed)

const validName = (n) => typeof n === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(n)
const validPass = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200

async function route(req, res) {
  const ip = req.socket.remoteAddress ?? '?'
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname

  if (req.method === 'GET' && path === '/api/ping') return send(res, 200, { ok: true, name: 'wave-sync', v: 2, register: ALLOW_REGISTER, features: ['profiles'] })

  if (req.method === 'POST' && path === '/api/register') {
    if (!ALLOW_REGISTER) throw new HttpError(403, 'Регистрация на этом сервере закрыта')
    if (limited(`reg|${ip}`, 10, 3600_000)) throw new HttpError(429, 'Слишком много попыток, попробуйте позже')
    const { username, password } = await readBody(req)
    if (!validName(username)) throw new HttpError(400, 'Имя: 3–32 символа, латиница, цифры, _ . -')
    if (!validPass(password)) throw new HttpError(400, 'Пароль должен быть не короче 8 символов')
    const key = username.toLowerCase()
    if (db.users[key]) throw new HttpError(409, 'Это имя уже занято')
    const salt = randomBytes(16).toString('hex')
    const id = randomUUID()
    db.users[key] = { id, name: username, salt, hash: hashPassword(password, salt), createdAt: Date.now() }
    const token = newSession(id)
    return send(res, 201, { token, username })
  }

  if (req.method === 'POST' && path === '/api/login') {
    const { username, password } = await readBody(req)
    if (!validName(username) || typeof password !== 'string') throw new HttpError(400, 'Неверное имя или пароль')
    if (limited(`login|${ip}|${username.toLowerCase()}`, 10, 15 * 60_000)) throw new HttpError(429, 'Слишком много попыток, подождите 15 минут')
    const user = db.users[username.toLowerCase()]
    if (!verifyPassword(password, user)) throw new HttpError(401, 'Неверное имя или пароль')
    return send(res, 200, { token: newSession(user.id), username: user.name })
  }

  if (req.method === 'POST' && path === '/api/logout') {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    if (m && db.sessions[sha(m[1])]) {
      delete db.sessions[sha(m[1])]
      saveDb()
    }
    return send(res, 200, { ok: true })
  }

  if (path === '/api/sync') {
    const userId = auth(req)
    if (limited(`sync|${userId}`, 600, 3600_000)) throw new HttpError(429, 'Слишком частые запросы')
    const file = docFile(userId)
    const cur = readJson(file, { rev: 0, data: null })
    if (req.method === 'GET') return send(res, 200, cur)
    if (req.method === 'PUT') {
      const { baseRev, data } = await readBody(req)
      if (!validDoc(data)) throw new HttpError(400, 'Некорректные данные')
      if (baseRev !== cur.rev) return send(res, 409, cur) // кто-то успел раньше — клиент объединит и повторит
      const next = { rev: cur.rev + 1, data }
      writeJson(file, next)
      return send(res, 200, { rev: next.rev })
    }
  }

  // ───── витрины профилей ─────
  // Витрину видят только пользователи этого сервера (нужен вход). Сервер хранит её как есть; содержимое
  // проверяет клиент при показе. Публикует и удаляет витрину только её владелец.

  if (path === '/api/profile' && (req.method === 'PUT' || req.method === 'DELETE')) {
    const userId = auth(req)
    if (limited(`profile|${userId}`, 240, 3600_000)) throw new HttpError(429, 'Слишком частые запросы')
    const user = Object.values(db.users).find((u) => u.id === userId)
    if (!user) throw new HttpError(401, 'Нужно войти заново')
    const file = profileFile(userId)
    if (req.method === 'DELETE') {
      if (existsSync(file)) rmSync(file, { force: true })
      return send(res, 200, { ok: true })
    }
    const body = await readBody(req)
    if (!isObj(body) || !isObj(body.profile) || (body.resolved !== undefined && !isObj(body.resolved))) throw new HttpError(400, 'Некорректные данные')
    const value = { username: user.name, updatedAt: Date.now(), profile: body.profile, resolved: body.resolved ?? {}, bannerCover: typeof body.bannerCover === 'string' ? body.bannerCover : undefined, thumb: typeof body.thumb === 'string' && body.thumb.length < 120_000 ? body.thumb : undefined }
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_PROFILE) throw new HttpError(413, 'Витрина слишком большая — уменьшите картинки')
    writeJson(file, value)
    return send(res, 200, { ok: true, at: value.updatedAt })
  }

  if (req.method === 'GET' && path === '/api/profiles') {
    auth(req)
    const list = []
    for (const u of Object.values(db.users)) {
      const p = readJson(profileFile(u.id), null)
      if (!p) continue
      const np = p.resolved && Object.values(p.resolved).find((r) => isObj(r) && isObj(r.nowPlaying))?.nowPlaying
      list.push({
        username: u.name,
        displayName: p.profile?.displayName ?? '',
        thumb: p.thumb,
        statusEmoji: p.profile?.statusEmoji,
        status: p.profile?.status,
        nowPlaying: np && Date.now() - (np.at ?? 0) < 15 * 60_000 ? `${np.sub ? `${np.sub} — ` : ''}${np.title}` : undefined,
        updatedAt: p.updatedAt
      })
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    return send(res, 200, { profiles: list.slice(0, 500) })
  }

  const pm = req.method === 'GET' && /^\/api\/profile\/([^/]+)$/.exec(path)
  if (pm) {
    auth(req)
    const name = decodeURIComponent(pm[1]).toLowerCase()
    const u = validName(name) && db.users[name]
    const p = u && readJson(profileFile(u.id), null)
    if (!p) throw new HttpError(404, 'Этот пользователь не показывает витрину')
    const { thumb: _t, ...rest } = p
    return send(res, 200, rest)
  }

  throw new HttpError(404, 'Не найдено')
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message })
    console.error(e)
    send(res, 500, { error: 'Внутренняя ошибка сервера' })
  })
})
server.headersTimeout = 15_000
server.requestTimeout = 30_000

server.listen(PORT, HOST, () => {
  console.log(`Wave sync: http://${HOST}:${PORT}  (данные: ${DATA}, регистрация: ${ALLOW_REGISTER ? 'открыта' : 'закрыта'})`)
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('Внимание: выставляйте наружу только за HTTPS-прокси — пароли не должны идти по сети открытым текстом.')
})
