import {
  connectInProgress as connectProtocol,
  type InProgressClient,
} from '@in-progress/protocol/client'

import type { ApiError, CreateForkRequest, CreateForkResponse, Workspace } from '../shared/model'
import { isRunActive } from '../shared/model'

declare const __TREE_COMPLETE_PLUGIN__: boolean

const REQUIRED_CAPABILITIES = ['tree-complete.workspace', 'tree-complete.createFork'] as const

const THEME_PROPERTIES = {
  background: ['--host-background', '--canvas'],
  surface: ['--host-surface', '--paper'],
  surfaceRaised: ['--host-surface-raised', '--paper-warm'],
  border: ['--host-border', '--line', '--line-dark'],
  text: ['--host-text', '--ink'],
  muted: ['--host-muted', '--muted', '--ink-soft'],
  accent: ['--host-accent', '--blue', '--acid'],
  warning: ['--host-warning', '--gold'],
  danger: ['--host-danger', '--coral'],
  uiFont: ['--ui-font'],
  monoFont: ['--mono-font'],
} as const

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

function applyTreeTheme(client: InProgressClient, root: HTMLElement): void {
  const theme = client.context.theme
  root.dataset.inProgressTheme = theme.mode
  root.style.setProperty('color-scheme', theme.mode)
  for (const [token, properties] of Object.entries(THEME_PROPERTIES)) {
    const value = theme.tokens[token]
    if (!value) continue
    for (const property of properties) root.style.setProperty(property, value)
  }
}

export async function connectInProgress(target: Window = window): Promise<InProgressClient> {
  const client = await connectProtocol({
    target,
    requiredCapabilities: REQUIRED_CAPABILITIES,
    applyTheme: false,
  })
  applyTreeTheme(client, target.document.documentElement)
  client.setStatus({ state: 'busy', badge: null, title: 'Loading Tree Complete' })
  return client
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
      // Preserve the HTTP status when an intermediary returned non-JSON.
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
    const workspace = await client.call('tree-complete.workspace', undefined, { signal })
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
    const response = await client.call('tree-complete.createFork', request, { signal })
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
    title: active
      ? `${active} active Tree Complete run${active === 1 ? '' : 's'}`
      : 'Tree Complete',
  })
}

export function readableError(error: unknown): string {
  if (error instanceof RequestError) {
    return error.detail ? `${error.message}: ${error.detail}` : error.message
  }
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong while contacting the workspace.'
}
