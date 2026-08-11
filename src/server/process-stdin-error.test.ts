import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.doUnmock('node:child_process')
  vi.resetModules()
})

describe('captured process input failure', () => {
  it.skipIf(process.platform === 'win32')(
    'kills the process group and clears deferred timers before rejecting',
    async () => {
      vi.useFakeTimers()
      const child = Object.assign(new EventEmitter(), {
        pid: 424_242,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      })
      vi.doMock('node:child_process', () => ({
        execFile: vi.fn(),
        spawn: vi.fn(() => child),
      }))
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
      const { spawnCaptured } = await import('./process.js')
      const pending = spawnCaptured('fixture', [], { input: 'input', timeoutMs: 100 })
      const inputError = Object.assign(new Error('fixture input failure'), { code: 'EIO' })

      child.stdin.emit('error', inputError)

      await expect(pending).rejects.toBe(inputError)
      expect(kill).toHaveBeenCalledTimes(1)
      expect(kill).toHaveBeenCalledWith(-424_242, 'SIGKILL')
      await vi.advanceTimersByTimeAsync(6_000)
      expect(kill).toHaveBeenCalledTimes(1)
    },
  )
})
