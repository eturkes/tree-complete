import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { ACTIVE_RUN_PHASES, type RunnerDescriptor, type Workspace } from '../shared/model.js'
import { validateRunnerEvidence } from './runners/evidence.js'

export interface WorkspaceStoreOptions {
  dataDir: string
  stateKey?: string
  seed: () => Workspace
  runner: RunnerDescriptor
  now?: () => Date
}

export type WorkspaceMutation<T> = (workspace: Workspace) => T | Promise<T>

export class WorkspaceStore {
  readonly statePath: string
  readonly dataDir: string

  private workspace!: Workspace
  private tail: Promise<void> = Promise.resolve()
  private readonly now: () => Date

  private constructor(private readonly options: WorkspaceStoreOptions) {
    const stateKey = options.stateKey ?? 'default'
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(stateKey)) {
      throw new Error('Workspace state key must be a short lowercase slug')
    }
    this.dataDir = options.dataDir
    this.statePath = join(options.dataDir, `workspace.${stateKey}.json`)
    this.now = options.now ?? (() => new Date())
  }

  static async open(options: WorkspaceStoreOptions): Promise<WorkspaceStore> {
    const store = new WorkspaceStore(options)
    await store.initialize()
    return store
  }

  async snapshot(): Promise<Workspace> {
    await this.tail
    return structuredClone(this.workspace)
  }

  async update<T>(mutation: WorkspaceMutation<T>): Promise<T> {
    let result!: T
    const operation = this.tail.then(async () => {
      const draft = structuredClone(this.workspace)
      result = await mutation(draft)
      draft.updatedAt = this.now().toISOString()
      assertWorkspaceShape(draft)
      await this.persist(draft)
      this.workspace = draft
    })
    this.tail = operation.catch(() => undefined)
    await operation
    return result
  }

  private async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
    let workspace: Workspace
    try {
      workspace = JSON.parse(await readFile(this.statePath, 'utf8')) as Workspace
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      workspace = this.options.seed()
      await this.persist(workspace)
    }

    const evidenceNormalized = assertWorkspaceShape(workspace)
    const runnerChanged = JSON.stringify(workspace.runner) !== JSON.stringify(this.options.runner)
    workspace.runner = this.options.runner
    const interrupted = recoverInterruptedRuns(workspace, this.now())
    this.workspace = workspace
    if (interrupted || runnerChanged || evidenceNormalized) {
      workspace.updatedAt = this.now().toISOString()
      await this.persist(workspace)
    }
  }

  private async persist(workspace: Workspace): Promise<void> {
    const temporaryPath = join(
      this.dataDir,
      `.${basename(this.statePath)}.${process.pid}.${randomUUID()}.tmp`,
    )
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(workspace, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporaryPath, this.statePath)
    } finally {
      await handle?.close().catch(() => undefined)
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

function assertWorkspaceShape(value: Workspace): boolean {
  if (
    !value ||
    typeof value !== 'object' ||
    !value.project ||
    !value.runner ||
    !Array.isArray(value.versions) ||
    !Array.isArray(value.runs) ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Persisted workspace has an invalid shape')
  }
  let normalized = false
  for (const candidate of value.runs as unknown[]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Persisted workspace has an invalid run shape')
    }
    const run = candidate as Workspace['runs'][number]
    if (run.result === undefined) continue
    if (run.mode !== 'preview' && run.mode !== 'codex') {
      throw new Error('Persisted workspace has an invalid runner mode')
    }
    const legacyEstimate = (run.result as unknown as { changeKind?: unknown }).changeKind === 'estimated'
    try {
      run.result = validateRunnerEvidence(run.result, run.mode)
    } catch (error) {
      throw new Error('Persisted workspace has invalid run result evidence', { cause: error })
    }
    normalized ||= legacyEstimate
  }
  return normalized
}

function recoverInterruptedRuns(workspace: Workspace, now: Date): boolean {
  const activePhases = new Set(ACTIVE_RUN_PHASES)
  let changed = false
  for (const run of workspace.runs) {
    if (!activePhases.has(run.phase)) continue
    changed = true
    run.phase = 'failed'
    run.progress = Math.min(run.progress, 99)
    run.completedAt = now.toISOString()
    run.error = 'The server restarted before this run completed.'
    run.logs.push({
      id: randomUUID(),
      at: now.toISOString(),
      message: 'Run marked failed after an interrupted server session.',
      tone: 'error',
    })
    const version = workspace.versions.find((candidate) => candidate.id === run.versionId)
    if (version) version.status = 'failed'
  }
  return changed
}
