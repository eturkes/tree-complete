import { execFile, spawn } from 'node:child_process'

import { asError } from './errors.js'

export interface ProcessResult {
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  code: number
}

export interface ProcessOptions {
  cwd?: string
  input?: string
  maxCaptureBytes?: number
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

const DEFAULT_CAPTURE_BYTES = 64 * 1024

export async function execFileChecked(
  executable: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        maxBuffer: options.maxCaptureBytes ?? DEFAULT_CAPTURE_BYTES,
        timeout: options.timeoutMs,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = compactProcessFailure(executable, error, stderr)
          reject(new Error(detail, { cause: error }))
          return
        }
        resolve({
          stdout,
          stderr,
          stdoutTruncated: false,
          stderrTruncated: false,
          code: 0,
        })
      },
    )
  })
}

export async function spawnCaptured(
  executable: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const captureLimit = options.maxCaptureBytes ?? DEFAULT_CAPTURE_BYTES
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = new TailBuffer(captureLimit)
    const stderr = new TailBuffer(captureLimit)
    let timedOut = false
    let settled = false
    let forceKillTimer: NodeJS.Timeout | undefined
    let timeout: NodeJS.Timeout | undefined
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      // The leader may exit successfully while a same-group descendant closes
      // its inherited streams and ignores SIGTERM. Settlement owns the whole
      // detached group, so leave no descendant beyond the returned promise.
      killProcessTree(child.pid, 'SIGKILL', child.kill.bind(child))
    }
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    timeout = options.timeoutMs
      ? setTimeout(() => {
          if (settled) return
          timedOut = true
          killProcessTree(child.pid, 'SIGTERM', child.kill.bind(child))
          forceKillTimer = setTimeout(
            () => killProcessTree(child.pid, 'SIGKILL', child.kill.bind(child)),
            5_000,
          )
          forceKillTimer.unref()
        }, options.timeoutMs)
      : undefined
    timeout?.unref()

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', (error) => rejectOnce(asError(error)))
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      const result: ProcessResult = {
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        code: code ?? 1,
      }
      if (timedOut) {
        reject(new ProcessExitError(`${executable} timed out`, result))
      } else if (code !== 0) {
        reject(
          new ProcessExitError(
            `${executable} exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`,
            result,
          ),
        )
      } else {
        resolve(result)
      }
    })

    child.stdin.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') rejectOnce(asError(error))
    })
    child.stdin.end(options.input ?? '')
  })
}

function killProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals,
  fallback: (signal?: NodeJS.Signals | number) => boolean,
): void {
  try {
    if (pid && process.platform !== 'win32') process.kill(-pid, signal)
    else fallback(signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') fallback(signal)
  }
}

export class ProcessExitError extends Error {
  constructor(
    message: string,
    readonly result: ProcessResult,
  ) {
    super(message)
    this.name = 'ProcessExitError'
  }
}

class TailBuffer {
  private chunks: Buffer[] = []
  private bytes = 0
  truncated = false

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.bytes += chunk.byteLength
    while (this.bytes > this.limit && this.chunks.length > 0) {
      const overflow = this.bytes - this.limit
      const first = this.chunks[0]
      if (first.byteLength <= overflow) {
        this.chunks.shift()
        this.bytes -= first.byteLength
      } else {
        this.chunks[0] = first.subarray(overflow)
        this.bytes -= overflow
      }
      this.truncated = true
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

function compactProcessFailure(command: string, error: Error, stderr: string): string {
  const suffix = stderr.trim().split('\n').at(-1)?.slice(0, 300)
  return suffix ? `${command} failed: ${suffix}` : `${command} failed: ${error.message}`
}
