import { spawn } from 'node:child_process'

const processes = [
  spawn('pnpm', ['run', 'dev:server'], { stdio: 'inherit', shell: false }),
  spawn('pnpm', ['run', 'dev:client'], { stdio: 'inherit', shell: false }),
]

let stopping = false

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) child.kill('SIGTERM')
  process.exitCode = exitCode
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error(error)
    stop(1)
  })
  child.on('exit', (code, signal) => {
    if (!stopping && signal === null && code !== 0) stop(code ?? 1)
  })
}

process.on('SIGINT', () => stop(130))
process.on('SIGTERM', () => stop(143))
