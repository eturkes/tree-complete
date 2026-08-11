import type {
  ApiError,
  CreateForkRequest,
  CreateForkResponse,
  Workspace,
} from '../shared/model'
import { isRunActive } from '../shared/model'

declare const __TREE_COMPLETE_PLUGIN__: boolean

const PLUGIN_API_VERSION = '1.0'
const PLUGIN_TIMEOUT_MS = 15_000

type PluginMethod = 'tree-complete.workspace' | 'tree-complete.createFork'

interface PluginContext {
  apiVersion: string
  capabilities: string[]
  project: { id: string; name: string }
}

type PluginResponse =
  | { kind: 'response'; id: string; ok: true; result: unknown }
  | { kind: 'response'; id: string; ok: false; error: string }

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: number
  signal?: AbortSignal
  abort?: () => void
}

export class RequestError extends Error {
  readonly status: number
  readonly detail?: string

  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'RequestError'
    this.status = status
    this.detail = detail
  }
}

export class InProgressClient {
  readonly #pending = new Map<string, PendingCall>()
  readonly #port: MessagePort
  readonly #target: Window
  readonly context: PluginContext

  constructor(
    context: PluginContext,
    port: MessagePort,
    target: Window,
  ) {
    this.context = context
    this.#port = port
    this.#target = target
    port.addEventListener('message', ({ data }: MessageEvent<PluginResponse>) => {
      if (!data || data.kind !== 'response' || typeof data.id !== 'string') return
      const pending = this.#pending.get(data.id)
      if (!pending) return
      this.#finish(data.id, pending)
      if (data.ok) pending.resolve(data.result)
      else pending.reject(new Error(typeof data.error === 'string' ? data.error : 'Plugin RPC failed'))
    })
    port.start()
  }

  call<T>(method: PluginMethod, params?: unknown, signal?: AbortSignal): Promise<T> {
    if (!this.context.capabilities.includes(method)) {
      return Promise.reject(new Error(`Capability not granted: ${method}`))
    }
    if (signal?.aborted) return Promise.reject(abortError(signal))
    const id = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = this.#target.setTimeout(() => {
        const pending = this.#pending.get(id)
        if (!pending) return
        this.#finish(id, pending)
        reject(new Error(`RPC timed out: ${method}`))
      }, PLUGIN_TIMEOUT_MS)
      const pending: PendingCall = {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      }
      if (signal) {
        pending.signal = signal
        pending.abort = () => {
          if (!this.#pending.has(id)) return
          this.#finish(id, pending)
          reject(abortError(signal))
        }
        signal.addEventListener('abort', pending.abort, { once: true })
      }
      this.#pending.set(id, pending)
      this.#port.postMessage({ kind: 'request', id, method, params })
    })
  }

  setStatus(status: {
    state: 'idle' | 'busy' | 'attention' | 'error'
    badge: string | null
    title: string | null
  }): void {
    this.#port.postMessage({ kind: 'event', name: 'status', payload: status })
  }

  dispose(): void {
    for (const [id, pending] of this.#pending) {
      this.#finish(id, pending)
      pending.reject(new Error('Plugin connection disposed'))
    }
    this.#port.close()
  }

  #finish(id: string, pending: PendingCall): void {
    this.#pending.delete(id)
    this.#target.clearTimeout(pending.timer)
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener('abort', pending.abort)
    }
  }
}

export function connectInProgress(target: Window = window): Promise<InProgressClient> {
  return new Promise((resolve, reject) => {
    const timer = target.setTimeout(() => {
      target.removeEventListener('message', receive)
      reject(new Error('in-progress host handshake timed out'))
    }, 10_000)

    function receive(event: MessageEvent): void {
      if (event.source !== target.parent || event.data?.type !== 'in-progress:init') return
      const port = event.ports[0]
      if (!port) return
      const context = event.data.context as PluginContext | undefined
      if (
        !context ||
        context.apiVersion !== PLUGIN_API_VERSION ||
        !Array.isArray(context.capabilities) ||
        typeof event.data.nonce !== 'string'
      ) {
        target.clearTimeout(timer)
        target.removeEventListener('message', receive)
        port.close()
        reject(new Error(`Unsupported in-progress host API: ${context?.apiVersion ?? 'unknown'}`))
        return
      }
      target.clearTimeout(timer)
      target.removeEventListener('message', receive)
      const client = new InProgressClient(context, port, target)
      port.postMessage({ kind: 'ready', nonce: event.data.nonce })
      client.setStatus({ state: 'busy', badge: null, title: 'Loading Tree Complete' })
      target.addEventListener('pagehide', () => client.dispose(), { once: true })
      resolve(client)
    }

    target.addEventListener('message', receive)
  })
}

const pluginConnection =
  typeof __TREE_COMPLETE_PLUGIN__ !== 'undefined' && __TREE_COMPLETE_PLUGIN__
    ? connectInProgress()
    : null

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let payload: ApiError | undefined
    try {
      payload = (await response.json()) as ApiError
    } catch {
      // An upstream proxy may return text or HTML; the status remains useful.
    }

    throw new RequestError(
      payload?.error || `Request failed (${response.status})`,
      response.status,
      payload?.detail,
    )
  }

  return (await response.json()) as T
}

export async function getWorkspace(signal?: AbortSignal): Promise<Workspace> {
  if (!pluginConnection) return await requestJson<Workspace>('/api/workspace', { signal })
  const client = await pluginConnection
  try {
    const workspace = await client.call<Workspace>('tree-complete.workspace', undefined, signal)
    publishWorkspaceStatus(client, workspace)
    return workspace
  } catch (error) {
    client.setStatus({ state: 'error', badge: null, title: 'Tree Complete unavailable' })
    throw error
  }
}

export async function createFork(
  request: CreateForkRequest,
  signal?: AbortSignal,
): Promise<CreateForkResponse> {
  if (!pluginConnection) {
    return await requestJson<CreateForkResponse>('/api/forks', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    })
  }
  const client = await pluginConnection
  client.setStatus({ state: 'busy', badge: null, title: 'Creating Tree Complete fork' })
  try {
    const response = await client.call<CreateForkResponse>(
      'tree-complete.createFork',
      request,
      signal,
    )
    publishWorkspaceStatus(client, response.workspace)
    return response
  } catch (error) {
    client.setStatus({ state: 'error', badge: null, title: 'Tree Complete fork failed' })
    throw error
  }
}

function publishWorkspaceStatus(client: InProgressClient, workspace: Workspace): void {
  const active = workspace.runs.filter(isRunActive).length
  client.setStatus({
    state: active ? 'busy' : 'idle',
    badge: active ? String(Math.min(active, 99)) : null,
    title: active ? `${active} active Tree Complete run${active === 1 ? '' : 's'}` : 'Tree Complete',
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
}

export function readableError(error: unknown): string {
  if (error instanceof RequestError) {
    return error.detail ? `${error.message}: ${error.detail}` : error.message
  }
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong while contacting the workspace.'
}
