import { randomUUID } from 'node:crypto'

import {
  isRunActive,
  type AgentRun,
  type CreateForkRequest,
  type CreateForkResponse,
  type DecisionAlternative,
  type DesignDecision,
  type ProgramVersion,
  type RunPhase,
  type Workspace,
} from '../shared/model.js'
import { ApiProblem, asError } from './errors.js'
import { safeSlug } from './git.js'
import { validateRunnerEvidence } from './runners/evidence.js'
import type { AgentRunner, RunTransition, RunnerContext } from './runners/types.js'
import type { WorkspaceStore } from './store.js'

export interface ForkOrchestratorOptions {
  store: WorkspaceStore
  runner?: AgentRunner
  diagnostic?: (message: string, error?: unknown) => void
  now?: () => Date
}

interface ReservedFork {
  runId: string
  versionId: string
}

export class ForkOrchestrator {
  private readonly store: WorkspaceStore
  private readonly runner?: AgentRunner
  private readonly diagnostic: (message: string, error?: unknown) => void
  private readonly now: () => Date
  private readonly tasks = new Map<string, Promise<void>>()

  constructor(options: ForkOrchestratorOptions) {
    this.store = options.store
    this.runner = options.runner
    this.diagnostic = options.diagnostic ?? (() => undefined)
    this.now = options.now ?? (() => new Date())
  }

  async createFork(request: CreateForkRequest): Promise<CreateForkResponse> {
    const reserved = await this.store.update((workspace) => this.reserve(workspace, request))
    const workspace = await this.store.snapshot()
    this.schedule(reserved.runId)
    return { ...reserved, workspace }
  }

  async waitForIdle(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks.values()])
    }
  }

  private reserve(workspace: Workspace, request: CreateForkRequest): ReservedFork {
    if (!workspace.runner.available || !this.runner) {
      throw new ApiProblem(503, 'runner_unavailable', workspace.runner.detail)
    }

    const base = workspace.versions.find((version) => version.id === request.baseVersionId)
    if (!base) {
      throw new ApiProblem(404, 'base_version_not_found', 'The selected base version does not exist.')
    }
    if (base.status !== 'ready' && base.status !== 'complete') {
      throw new ApiProblem(
        409,
        'base_version_not_forkable',
        'A fork can start only from a ready or completed version.',
      )
    }

    const decision = base.decisions.find((candidate) => candidate.id === request.decisionId)
    if (!decision) {
      throw new ApiProblem(
        404,
        'decision_not_found',
        'The selected decision does not exist on that version.',
      )
    }
    const alternative = decision.alternatives.find(
      (candidate) => candidate.id === request.alternativeId,
    )
    if (!alternative) {
      throw new ApiProblem(
        404,
        'alternative_not_found',
        'The selected alternative does not exist on that decision.',
      )
    }
    if (alternative.id === decision.chosenAlternativeId) {
      throw new ApiProblem(
        409,
        'alternative_already_selected',
        'Choose an alternative other than the version’s current design.',
      )
    }

    const duplicate = workspace.versions.find(
      (version) =>
        version.parentId === base.id &&
        version.forkOrigin?.decisionId === decision.id &&
        version.forkOrigin.toAlternativeId === alternative.id &&
        version.runId !== undefined &&
        workspace.runs.some((run) => run.id === version.runId && isRunActive(run)),
    )
    if (duplicate) {
      throw new ApiProblem(
        409,
        'fork_already_active',
        'This exact fork is already being generated from the selected version.',
      )
    }
    const activeRuns = workspace.runs.filter(isRunActive).length
    if (activeRuns >= 2) {
      throw new ApiProblem(
        429,
        'active_run_limit_reached',
        'Wait for an active fork to finish before starting another.',
      )
    }

    const versionId = randomUUID()
    const runId = randomUUID()
    const createdAt = this.now().toISOString()
    const shortId = versionId.replaceAll('-', '').slice(0, 10)
    const decisions = structuredClone(base.decisions)
    const forkedDecision = decisions.find((candidate) => candidate.id === decision.id)
    if (!forkedDecision) throw new Error('Cloned version lost its forked decision')
    forkedDecision.chosenAlternativeId = alternative.id

    const version: ProgramVersion = {
      id: versionId,
      parentId: base.id,
      name: `${alternative.label} fork`,
      branch: `tree-complete/${safeSlug(decision.id)}/${safeSlug(alternative.id)}-${shortId}`,
      commit: base.commit,
      createdAt,
      status: 'queued',
      summary: `Forking ${decision.title} from ${chosenLabel(decision)} to ${alternative.label}.`,
      decisions,
      forkOrigin: {
        decisionId: decision.id,
        fromAlternativeId: decision.chosenAlternativeId,
        toAlternativeId: alternative.id,
      },
      runId,
    }
    const run: AgentRun = {
      id: runId,
      versionId,
      mode: this.runner.mode,
      phase: 'queued',
      progress: 4,
      startedAt: createdAt,
      logs: [
        {
          id: randomUUID(),
          at: createdAt,
          message: `Fork queued from ${base.name}.`,
          tone: 'muted',
        },
      ],
    }
    workspace.versions.push(version)
    workspace.runs.push(run)
    return { runId, versionId }
  }

  private schedule(runId: string): void {
    const task = this.execute(runId)
      .catch((error) => this.diagnostic(`Unrecoverable orchestration error for run ${runId}`, error))
      .finally(() => this.tasks.delete(runId))
    this.tasks.set(runId, task)
  }

  private async execute(runId: string): Promise<void> {
    try {
      const context = await this.contextFor(runId)
      if (!this.runner) throw new Error('No agent runner is configured')
      const result = await this.runner.run(context)
      const evidence = validateRunnerEvidence(result.evidence, context.run.mode)
      await this.store.update((workspace) => {
        const run = requiredRun(workspace, runId)
        const version = requiredVersion(workspace, run.versionId)
        const at = this.now().toISOString()
        run.phase = 'complete'
        run.progress = 100
        run.completedAt = at
        run.error = undefined
        run.result = evidence
        const completionLabel = run.mode === 'preview' ? 'Preview complete' : 'Fork complete'
        const changedFileCount = evidence.changedFileCount
        const resultDetail = evidence.changeKind === 'simulated'
          ? `a simulated count of ${changedFileCount}`
          : `${changedFileCount}`
        run.logs.push({
          id: randomUUID(),
          at,
          message: `${completionLabel} at ${result.commit.slice(0, 12)} with ${resultDetail} affected file${changedFileCount === 1 ? '' : 's'}.`,
          tone: 'success',
        })
        version.status = 'complete'
        version.commit = result.commit
        version.changedFiles = changedFileCount
        version.summary = result.summary
      })
    } catch (error) {
      const failure = safeFailure(error)
      this.diagnostic(`Fork run ${runId} failed`, error)
      await this.store.update((workspace) => {
        const run = workspace.runs.find((candidate) => candidate.id === runId)
        if (!run || run.phase === 'complete' || run.phase === 'failed') return
        const at = this.now().toISOString()
        run.phase = 'failed'
        run.progress = Math.min(run.progress, 99)
        run.completedAt = at
        run.error = failure
        run.logs.push({
          id: randomUUID(),
          at,
          message: failure,
          tone: 'error',
        })
        const version = workspace.versions.find((candidate) => candidate.id === run.versionId)
        if (version) version.status = 'failed'
      })
    }
  }

  private async contextFor(runId: string): Promise<RunnerContext> {
    const workspace = await this.store.snapshot()
    const run = requiredRun(workspace, runId)
    const version = requiredVersion(workspace, run.versionId)
    const baseVersion = requiredVersion(workspace, version.parentId)
    const origin = version.forkOrigin
    if (!origin) throw new Error('Fork version has no origin metadata')
    const decision = requiredDecision(baseVersion, origin.decisionId)
    const fromAlternative = requiredAlternative(decision, origin.fromAlternativeId)
    const toAlternative = requiredAlternative(decision, origin.toAlternativeId)

    return {
      run,
      version,
      baseVersion,
      decision,
      fromAlternative,
      toAlternative,
      transition: async (transition) => await this.transition(runId, transition),
      setWorktree: async (path) => {
        await this.store.update((draft) => {
          requiredRun(draft, runId).worktreePath = path
        })
      },
      diagnostic: this.diagnostic,
    }
  }

  private async transition(runId: string, transition: RunTransition): Promise<void> {
    await this.store.update((workspace) => {
      const run = requiredRun(workspace, runId)
      const version = requiredVersion(workspace, run.versionId)
      if (run.phase === 'complete' || run.phase === 'failed') {
        throw new Error(`Cannot move terminal run ${run.id} to ${transition.phase}`)
      }
      run.phase = transition.phase
      run.progress = Math.max(run.progress, Math.min(99, transition.progress))
      run.logs.push({
        id: randomUUID(),
        at: this.now().toISOString(),
        message: transition.message,
        tone: transition.tone ?? toneFor(transition.phase),
      })
      version.status = transition.phase === 'queued' ? 'queued' : 'working'
    })
  }
}

function requiredRun(workspace: Workspace, id: string): AgentRun {
  const run = workspace.runs.find((candidate) => candidate.id === id)
  if (!run) throw new Error(`Run ${id} is missing`)
  return run
}

function requiredVersion(workspace: Workspace, id: string | null): ProgramVersion {
  const version = id ? workspace.versions.find((candidate) => candidate.id === id) : undefined
  if (!version) throw new Error(`Version ${id ?? '(null)'} is missing`)
  return version
}

function requiredDecision(version: ProgramVersion, id: string): DesignDecision {
  const decision = version.decisions.find((candidate) => candidate.id === id)
  if (!decision) throw new Error(`Decision ${id} is missing`)
  return decision
}

function requiredAlternative(
  decision: DesignDecision,
  id: string,
): DecisionAlternative {
  const alternative = decision.alternatives.find((candidate) => candidate.id === id)
  if (!alternative) throw new Error(`Alternative ${id} is missing`)
  return alternative
}

function chosenLabel(decision: DesignDecision): string {
  return requiredAlternative(decision, decision.chosenAlternativeId).label
}

function toneFor(phase: RunPhase): 'muted' | 'active' | 'success' | 'error' {
  if (phase === 'complete') return 'success'
  if (phase === 'failed') return 'error'
  return phase === 'queued' ? 'muted' : 'active'
}

function safeFailure(value: unknown): string {
  const error = asError(value)
  const message = error.message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500)
  return message || 'The agent run failed.'
}
