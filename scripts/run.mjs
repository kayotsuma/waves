// Запускает electron-vite, предварительно сбросив ELECTRON_RUN_AS_NODE:
// эта переменная (её выставляют некоторые IDE) заставляет Electron работать как обычный Node без окон.
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite')
const child = spawn(bin, process.argv.slice(2), { stdio: 'inherit', env, cwd: root, shell: process.platform === 'win32' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
