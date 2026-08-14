import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import type { RunnerDescriptor, RunnerMode } from '../shared/model.js'

export interface ServerConfig {
  agentMode: RunnerMode
  targetRepo?: string
  dataDir: string
  host: string
  port: number
  previewPhaseDelayMs: number
}

export type ServerConfigOverrides = Partial<ServerConfig>

function parsePort(value: string | undefined): number {
  const port = value === undefined ? 4318 : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('TREE_COMPLETE_PORT must be an integer from 1 through 65535')
  }
  return port
}

function parseMode(value: string | undefined): RunnerMode {
  if (value === undefined || value === '' || value === 'preview') return 'preview'
  if (value === 'codex') return 'codex'
  throw new Error('TREE_COMPLETE_AGENT_MODE must be "preview" or "codex"')
}

function parseHost(value: string | undefined): string {
  const host = value ?? '127.0.0.1'
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    throw new Error('TREE_COMPLETE_HOST must be a loopback host (127.0.0.1, ::1, or localhost)')
  }
  return host
}

export function loadServerConfig(
  overrides: ServerConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const targetRepo = overrides.targetRepo ?? env.TREE_COMPLETE_TARGET_REPO
  return {
    agentMode: overrides.agentMode ?? parseMode(env.TREE_COMPLETE_AGENT_MODE),
    targetRepo: targetRepo ? resolve(targetRepo) : undefined,
    dataDir: resolve(
      overrides.dataDir ?? env.TREE_COMPLETE_DATA_DIR ?? resolve(process.cwd(), '.tree-complete'),
    ),
    host: parseHost(overrides.host ?? env.TREE_COMPLETE_HOST),
    port: overrides.port ?? parsePort(env.TREE_COMPLETE_PORT),
    previewPhaseDelayMs: overrides.previewPhaseDelayMs ?? 55,
  }
}

export function runnerDescriptor(config: ServerConfig): RunnerDescriptor {
  if (config.agentMode === 'codex') {
    const available = Boolean(config.targetRepo)
    return {
      mode: 'codex',
      label: 'Codex workspace agent',
      available,
      detail: available
        ? 'Creates an isolated Git worktree, asks Codex to implement the choice, then verifies and commits it.'
        : 'Set TREE_COMPLETE_TARGET_REPO to enable live Codex forks.',
    }
  }

  return {
    mode: 'preview',
    label: 'Preview agent',
    available: true,
    detail: 'Runs a short local simulation without changing a repository.',
  }
}

export function workspaceStateKey(mode: RunnerMode, identity?: string): string {
  if (!identity) return mode === 'preview' ? 'preview' : 'codex-unconfigured'
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 12)
  return `${mode}-${digest}`
}
