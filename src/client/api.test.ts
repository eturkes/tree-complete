import { afterEach, describe, expect, it, vi } from 'vitest'

import { connectInProgress, createFork, getWorkspace } from './api'

afterEach(() => vi.unstubAllGlobals())

class FakePort {
  closed = false
  messages: unknown[] = []
  listener?: (event: MessageEvent) => void

  addEventListener(_name: string, listener: (event: MessageEvent) => void): void {
    this.listener = listener
  }

  start(): void {}

  close(): void {
    this.closed = true
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  respond(message: unknown): void {
    this.listener?.({ data: message } as MessageEvent)
  }
}

function fakeWindow(): {
  target: Window
  parent: object
  receive: () => (event: MessageEvent) => void
  theme: { dataset: Record<string, string>; properties: Map<string, string> }
} {
  const parent = {}
  const listeners = new Map<string, EventListener>()
  const dataset: Record<string, string> = {}
  const properties = new Map<string, string>()
  const target = {
    parent,
    document: {
      documentElement: {
        dataset,
        style: {
          setProperty(name: string, value: string) {
            properties.set(name, value)
          },
        },
      },
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener(name: string, listener: EventListener) {
      listeners.set(name, listener)
    },
    removeEventListener(name: string, listener: EventListener) {
      if (listeners.get(name) === listener) listeners.delete(name)
    },
  } as unknown as Window
  return {
    target,
    parent,
    receive: () => listeners.get('message') as (event: MessageEvent) => void,
    theme: { dataset, properties },
  }
}

const darkTheme = {
  mode: 'dark',
  tokens: {
    background: '#0b0e14',
    surface: '#121722',
    surfaceRaised: '#18202c',
    border: '#283142',
    text: '#e7ecf4',
    muted: '#909cb0',
    accent: '#67d5b5',
    warning: '#f2b84b',
    danger: '#ff6b78',
    uiFont: 'Atkinson Hyperlegible Next',
    monoFont: 'Iosevka',
  },
} as const

describe('in-progress plugin transport', () => {
  it('verifies the handshake and carries typed request/response messages', async () => {
    const host = fakeWindow()
    const port = new FakePort()
    const connected = connectInProgress(host.target)
    host.receive()({
      source: host.parent as WindowProxy,
      data: {
        type: 'in-progress:init',
        nonce: 'nonce-1',
        context: {
          apiVersion: '1.0',
          capabilities: ['tree-complete.workspace', 'tree-complete.createFork'],
          project: { id: 'fixture', name: 'Fixture' },
          theme: darkTheme,
        },
      },
      ports: [port as unknown as MessagePort],
    } as unknown as MessageEvent)
    const client = await connected
    expect(port.messages.slice(0, 2)).toEqual([
      { kind: 'ready', nonce: 'nonce-1' },
      {
        kind: 'event',
        name: 'status',
        payload: { state: 'busy', badge: null, title: 'Loading Tree Complete' },
      },
    ])
    expect(host.theme.dataset.inProgressTheme).toBe('dark')
    expect(host.theme.properties.get('color-scheme')).toBe('dark')
    expect(host.theme.properties.get('--canvas')).toBe('#0b0e14')
    expect(host.theme.properties.get('--paper')).toBe('#121722')
    expect(host.theme.properties.get('--host-surface-raised')).toBe('#18202c')
    expect(host.theme.properties.get('--ink')).toBe('#e7ecf4')
    expect(host.theme.properties.get('--ui-font')).toBe('Atkinson Hyperlegible Next')

    const workspace = client.call<{ project: string }>('tree-complete.workspace')
    const request = port.messages.at(-1) as { id: string; method: string }
    expect(request.method).toBe('tree-complete.workspace')
    port.respond({ kind: 'response', id: request.id, ok: true, result: { project: 'fixture' } })
    await expect(workspace).resolves.toEqual({ project: 'fixture' })
  })

  it('rejects incompatible hosts and undeclared capabilities', async () => {
    const host = fakeWindow()
    const port = new FakePort()
    const rejected = connectInProgress(host.target)
    host.receive()({
      source: host.parent as WindowProxy,
      data: {
        type: 'in-progress:init',
        nonce: 'nonce-2',
        context: { apiVersion: '2.0', capabilities: [], project: {}, theme: darkTheme },
      },
      ports: [port as unknown as MessagePort],
    } as unknown as MessageEvent)
    await expect(rejected).rejects.toThrow('Unsupported in-progress host API: 2.0')
    expect(port.closed).toBe(true)

    const compatible = fakeWindow()
    const compatiblePort = new FakePort()
    const connection = connectInProgress(compatible.target)
    compatible.receive()({
      source: compatible.parent as WindowProxy,
      data: {
        type: 'in-progress:init',
        nonce: 'nonce-3',
        context: {
          apiVersion: '1.0',
          capabilities: [],
          project: { id: 'fixture' },
          theme: darkTheme,
        },
      },
      ports: [compatiblePort as unknown as MessagePort],
    } as unknown as MessageEvent)
    const client = await connection
    await expect(client.call('tree-complete.workspace')).rejects.toThrow(
      'Capability not granted: tree-complete.workspace',
    )
  })

  it('rejects an API 1.0 handshake without the required host theme', async () => {
    const host = fakeWindow()
    const port = new FakePort()
    const rejected = connectInProgress(host.target)
    host.receive()({
      source: host.parent as WindowProxy,
      data: {
        type: 'in-progress:init',
        nonce: 'nonce-without-theme',
        context: {
          apiVersion: '1.0',
          capabilities: ['tree-complete.workspace'],
          project: { id: 'fixture', name: 'Fixture' },
        },
      },
      ports: [port as unknown as MessagePort],
    } as unknown as MessageEvent)

    await expect(rejected).rejects.toThrow('Unsupported in-progress host API: 1.0')
    expect(port.closed).toBe(true)
    expect(host.theme.dataset.inProgressTheme).toBeUndefined()
  })
})

describe('standalone HTTP transport', () => {
  it('retains the workspace and fork routes outside the plugin build', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      )
    vi.stubGlobal('fetch', fetch)

    await getWorkspace()
    await createFork({
      baseVersionId: 'base',
      decisionId: 'decision',
      alternativeId: 'alternative',
    })

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/workspace',
      expect.objectContaining({ signal: undefined }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/forks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          baseVersionId: 'base',
          decisionId: 'decision',
          alternativeId: 'alternative',
        }),
      }),
    )
  })
})
