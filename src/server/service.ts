import type { CreateForkRequest, CreateForkResponse, Workspace } from '../shared/model.js'
import {
  loadServerConfig,
  runnerDescriptor,
  workspaceStateKey,
  type ServerConfig,
  type ServerConfigOverrides,
} from './config.js'
import { inspectGitRepository, safeSlug, type GitRepositoryMetadata } from './git.js'
import {
  manifestToDesignDecisions,
  readProjectManifestAtCommit,
  readProjectManifestAtCommitIfPresent,
  type ProjectManifest,
} from './manifest.js'
import { ForkOrchestrator } from './orchestrator.js'
import { publicWorkspace } from './public.js'
import { CodexRunner } from './runners/codex.js'
import { PreviewRunner } from './runners/preview.js'
import type { AgentRunner } from './runners/types.js'
import { createSeedWorkspace } from './seed.js'
import { WorkspaceStore } from './store.js'

export interface CreateTreeCompleteServiceOptions {
  config?: ServerConfigOverrides
  store?: WorkspaceStore
  runner?: AgentRunner
  seed?: () => Workspace
  diagnostic?: (message: string, error?: unknown) => void
}

export class TreeCompleteService {
  readonly config: ServerConfig
  readonly workspaceStore: WorkspaceStore
  readonly forkOrchestrator: ForkOrchestrator
  readonly runnerStatus: {
    status: 'ready' | 'degraded'
    runner: { mode: 'preview' | 'codex'; available: boolean }
  }

  readonly #redactedPaths: (string | undefined)[]
  #closed = false
  #closing?: Promise<void>
  readonly #operations = new Set<Promise<unknown>>()

  constructor(
    config: ServerConfig,
    store: WorkspaceStore,
    orchestrator: ForkOrchestrator,
    runnerAvailable: boolean,
  ) {
    this.config = config
    this.workspaceStore = store
    this.forkOrchestrator = orchestrator
    this.runnerStatus = {
      status: runnerAvailable ? 'ready' : 'degraded',
      runner: { mode: config.agentMode, available: runnerAvailable },
    }
    this.#redactedPaths = [config.targetRepo, config.dataDir]
  }

  workspace(): Promise<Workspace> {
    return this.#track(async () =>
      publicWorkspace(await this.workspaceStore.snapshot(), this.#redactedPaths),
    )
  }

  createFork(request: CreateForkRequest): Promise<CreateForkResponse> {
    return this.#track(async () => {
      const response = await this.forkOrchestrator.createFork(request)
      return {
        ...response,
        workspace: publicWorkspace(response.workspace, this.#redactedPaths),
      }
    })
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closed = true
    this.#closing = (async () => {
      await Promise.allSettled(this.#operations)
      await this.forkOrchestrator.waitForIdle()
    })()
    return this.#closing
  }

  #track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error('Tree Complete service is closed.')
    const pending = operation()
    this.#operations.add(pending)
    void pending.then(
      () => this.#operations.delete(pending),
      () => this.#operations.delete(pending),
    )
    return pending
  }
}

export async function createTreeCompleteService(
  options: CreateTreeCompleteServiceOptions = {},
): Promise<TreeCompleteService> {
  let config = loadServerConfig(options.config)
  let repository: GitRepositoryMetadata | undefined
  if (config.targetRepo) {
    repository = await inspectGitRepository(config.targetRepo)
    config = { ...config, targetRepo: repository.root }
  }
  const manifest: ProjectManifest | undefined = repository
    ? config.agentMode === 'codex'
      ? await readProjectManifestAtCommit(repository.root, repository.commit)
      : await readProjectManifestAtCommitIfPresent(repository.root, repository.commit)
    : undefined
  const descriptor =
    repository && config.agentMode === 'preview'
      ? {
          ...runnerDescriptor(config),
          detail: manifest
            ? `Read-only simulation bound to ${repository.name} at committed HEAD ${shortCommit(repository.commit)}; target files and Git refs stay unchanged.`
            : `Read-only simulation bound to ${repository.name} at committed HEAD ${shortCommit(repository.commit)}; no committed .tree-complete/project.json exists, so decisions are generic examples and project files and Git state stay unchanged.`,
        }
      : runnerDescriptor(config)
  const genericRepositoryPreview = Boolean(
    repository && config.agentMode === 'preview' && !manifest,
  )
  const seed =
    options.seed ??
    (() =>
      createSeedWorkspace({
        runner: descriptor,
        ...(repository
          ? {
              project: {
                id: manifest?.project.id ?? safeSlug(repository.name, 'project'),
                name: manifest?.project.name ?? repository.name,
                description:
                  manifest?.project.description ??
                  (genericRepositoryPreview
                    ? `Read-only preview of ${repository.name}. No committed .tree-complete/project.json was found; displayed decisions are generic simulation examples.`
                    : `Design-decision workspace for ${repository.name}.`),
                repository: `git:${manifest?.project.id ?? safeSlug(repository.name, 'project')}`,
                defaultBranch: repository.branch,
              },
              rootBranch: repository.branch,
              rootCommit: repository.commit,
              rootName: genericRepositoryPreview
                ? 'Committed HEAD · generic preview'
                : 'Committed design',
              rootSummary: genericRepositoryPreview
                ? `Generic illustrative decisions at committed HEAD ${shortCommit(repository.commit)}; no .tree-complete/project.json was found and preview does not mutate project files or Git state.`
                : `Manifest-backed baseline at committed HEAD ${shortCommit(repository.commit)}.`,
              decisions: manifest ? manifestToDesignDecisions(manifest) : undefined,
            }
          : {}),
      }))
  const store =
    options.store ??
    (await WorkspaceStore.open({
      dataDir: config.dataDir,
      stateKey: workspaceStateKey(
        config.agentMode,
        repository
          ? config.agentMode === 'preview'
            ? `${repository.root}\0${repository.branch}\0${repository.commit}\0${manifest?.project.id ?? 'generic'}\0preview-v1`
            : `${repository.root}\0${manifest?.project.id ?? 'unconfigured'}\0manifest-v1`
          : undefined,
      ),
      seed,
      runner: descriptor,
    }))
  const runner = options.runner ?? createRunner(config)
  const orchestrator = new ForkOrchestrator({
    store,
    runner,
    publicWorkspace: (workspace) => publicWorkspace(workspace, [config.targetRepo, config.dataDir]),
    diagnostic: options.diagnostic,
  })
  return new TreeCompleteService(config, store, orchestrator, descriptor.available)
}

function shortCommit(commit: string): string {
  return commit.slice(0, 12)
}

function createRunner(config: ServerConfig): AgentRunner | undefined {
  if (config.agentMode === 'preview') return new PreviewRunner(config.previewPhaseDelayMs)
  if (!config.targetRepo) return undefined
  return new CodexRunner({ repository: config.targetRepo, dataDir: config.dataDir })
}
