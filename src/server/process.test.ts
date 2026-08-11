import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'

import { spawnCaptured } from './process.js'

describe('captured process lifecycle', () => {
  it.skipIf(process.platform === 'win32')(
    'kills a successful leader\'s same-group descendant even when it ignores SIGTERM',
    async () => {
      const descendantSource = [
        "process.on('SIGTERM', () => undefined)",
        "process.send?.('ready', () => process.disconnect())",
        'setInterval(() => undefined, 1_000)',
      ].join(';')
      const leaderSource = [
        "import { spawn } from 'node:child_process'",
        `const child = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(descendantSource)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })`,
        "child.once('message', () => { process.stdout.write(String(child.pid)); child.unref() })",
      ].join(';')

      let descendantPid: number | undefined
      try {
        const result = await spawnCaptured(
          process.execPath,
          ['--input-type=module', '-e', leaderSource],
          { timeoutMs: 5_000 },
        )
        descendantPid = Number(result.stdout)
        expect(Number.isSafeInteger(descendantPid) && descendantPid > 1).toBe(true)
        await expect(waitForExit(descendantPid)).resolves.toBeUndefined()
      } finally {
        if (descendantPid) {
          try {
            process.kill(descendantPid, 'SIGKILL')
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
          }
        }
      }
    },
  )
})

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    await delay(10)
  }
  throw new Error(`Descendant ${pid} survived process settlement`)
}
