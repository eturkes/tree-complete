export type RunnerMode = 'preview' | 'codex'

export type VersionStatus = 'ready' | 'queued' | 'working' | 'complete' | 'failed'

export type RunPhase =
  | 'queued'
  | 'preparing'
  | 'generating'
  | 'verifying'
  | 'complete'
  | 'failed'

export type AlternativeSignal = 'recommended' | 'balanced' | 'experimental'

export interface DecisionAlternative {
  id: string
  label: string
  description: string
  impact: string
  agentBrief: string
  signal: AlternativeSignal
}

export interface DesignDecision {
  id: string
  title: string
  question: string
  rationale: string
  chosenAlternativeId: string
  alternatives: DecisionAlternative[]
}

export interface ForkOrigin {
  decisionId: string
  fromAlternativeId: string
  toAlternativeId: string
}

export interface ProgramVersion {
  id: string
  parentId: string | null
  name: string
  branch: string
  commit: string
  createdAt: string
  status: VersionStatus
  summary: string
  decisions: DesignDecision[]
  forkOrigin?: ForkOrigin
  runId?: string
  changedFiles?: number
}

export interface RunLogEntry {
  id: string
  at: string
  message: string
  tone: 'muted' | 'active' | 'success' | 'error'
}

export type RunChangeKind = 'measured' | 'simulated'

export type RunCheckStatus = 'passed' | 'simulated'

export interface RunCheckResult {
  id: string
  label: string
  detail: string
  status: RunCheckStatus
}

export interface AgentRunResult {
  changeKind: RunChangeKind
  changedFileCount: number
  changedFiles: string[]
  changedFilesTruncated: boolean
  checks: RunCheckResult[]
}

// Matches the in-progress host's maximum encoded Tree Complete result.
export const TREE_COMPLETE_PUBLIC_RESPONSE_MAX_BYTES = 4 * 1024 * 1024
export const MAX_RUN_RESULT_CHANGED_FILES = 40
export const MAX_RUN_RESULT_CHANGED_FILE_LENGTH = 240
export const MAX_RUN_RESULT_CHECKS = 16
export const MAX_RUN_RESULT_CHECK_ID_LENGTH = 64
export const MAX_RUN_RESULT_CHECK_LABEL_LENGTH = 120
export const MAX_RUN_RESULT_CHECK_DETAIL_LENGTH = 500
export const MAX_RUN_RESULT_COMMIT_LENGTH = 128
export const MAX_RUN_RESULT_SUMMARY_LENGTH = 2_000
export const MAX_RUN_LOG_ENTRIES = 8
export const MAX_RUN_LOG_MESSAGE_LENGTH = 500
export const MAX_RUN_WORKTREE_PATH_LENGTH = 4_096

export interface AgentRun {
  id: string
  versionId: string
  mode: RunnerMode
  phase: RunPhase
  progress: number
  startedAt: string
  completedAt?: string
  worktreePath?: string
  error?: string
  result?: AgentRunResult
  logs: RunLogEntry[]
}

export interface ProjectDescriptor {
  id: string
  name: string
  description: string
  repository: string
  defaultBranch: string
}

export interface RunnerDescriptor {
  mode: RunnerMode
  label: string
  available: boolean
  detail: string
}

export interface Workspace {
  project: ProjectDescriptor
  runner: RunnerDescriptor
  versions: ProgramVersion[]
  runs: AgentRun[]
  updatedAt: string
}

export interface CreateForkRequest {
  baseVersionId: string
  decisionId: string
  alternativeId: string
}

export interface CreateForkResponse {
  runId: string
  versionId: string
  workspace: Workspace
}

export interface ApiError {
  error: string
  detail?: string
}

export const ACTIVE_RUN_PHASES: readonly RunPhase[] = [
  'queued',
  'preparing',
  'generating',
  'verifying',
]

export function isRunActive(run: AgentRun): boolean {
  return ACTIVE_RUN_PHASES.includes(run.phase)
}

export function chosenAlternative(decision: DesignDecision): DecisionAlternative {
  const choice = decision.alternatives.find(
    (alternative) => alternative.id === decision.chosenAlternativeId,
  )
  if (!choice) throw new Error(`Decision ${decision.id} has no chosen alternative`)
  return choice
}
