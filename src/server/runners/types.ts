import type {
  AgentRun,
  DecisionAlternative,
  DesignDecision,
  ProgramVersion,
  RunPhase,
  RunnerMode,
} from '../../shared/model.js'

export interface RunTransition {
  phase: RunPhase
  progress: number
  message: string
  tone?: 'muted' | 'active' | 'success' | 'error'
}

export interface RunnerContext {
  run: AgentRun
  version: ProgramVersion
  baseVersion: ProgramVersion
  decision: DesignDecision
  fromAlternative: DecisionAlternative
  toAlternative: DecisionAlternative
  transition: (transition: RunTransition) => Promise<void>
  setWorktree: (path: string) => Promise<void>
  diagnostic: (message: string, error?: unknown) => void
}

export interface RunnerResult {
  commit: string
  changedFiles: number
  summary: string
}

export interface AgentRunner {
  readonly mode: RunnerMode
  run(context: RunnerContext): Promise<RunnerResult>
}
