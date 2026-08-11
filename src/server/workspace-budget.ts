import {
  MAX_RUN_LOG_ENTRIES,
  MAX_RUN_LOG_MESSAGE_LENGTH,
  MAX_RUN_RESULT_CHANGED_FILE_LENGTH,
  MAX_RUN_RESULT_CHANGED_FILES,
  MAX_RUN_RESULT_CHECK_DETAIL_LENGTH,
  MAX_RUN_RESULT_CHECK_ID_LENGTH,
  MAX_RUN_RESULT_CHECK_LABEL_LENGTH,
  MAX_RUN_RESULT_CHECKS,
  MAX_RUN_RESULT_COMMIT_LENGTH,
  MAX_RUN_RESULT_SUMMARY_LENGTH,
  MAX_RUN_WORKTREE_PATH_LENGTH,
  TREE_COMPLETE_PUBLIC_RESPONSE_MAX_BYTES,
  isRunActive,
  type AgentRun,
  type AgentRunResult,
  type ProgramVersion,
  type Workspace,
} from '../shared/model.js'

export type PublicWorkspaceProjection = (workspace: Workspace) => Workspace

export interface ForkAdmissionBudget {
  accepted: boolean
  requiredBytes: number
  limitBytes: number
}

// JSON.stringify expands an unpaired surrogate to six ASCII escape bytes, the
// largest representation of one JavaScript string element.
const MAX_JSON_CHARACTER = '\ud800'
const ISO_TIMESTAMP_LENGTH = 24
const UUID_LENGTH = 36

/**
 * Measures the exact compact UTF-8 representation used by the embedded host.
 */
export function encodedJsonBytes(value: unknown): number {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Tree Complete public data is not JSON-encodable')
  return Buffer.byteLength(encoded)
}

/**
 * Tests a reservation against a pessimistic terminal projection of every active
 * run, including the candidate. The input workspace is never mutated.
 */
export function assessForkAdmission(
  workspace: Workspace,
  version: ProgramVersion,
  run: AgentRun,
  projectPublicWorkspace: PublicWorkspaceProjection,
): ForkAdmissionBudget {
  const prospective = structuredClone(workspace)
  prospective.versions.push(structuredClone(version))
  prospective.runs.push(structuredClone(run))
  maximizeActiveRunLifecycles(prospective)

  const publicWorkspace = projectPublicWorkspace(prospective)
  const requiredBytes = encodedJsonBytes({
    runId: run.id,
    versionId: version.id,
    workspace: publicWorkspace,
  })
  return {
    accepted: requiredBytes <= TREE_COMPLETE_PUBLIC_RESPONSE_MAX_BYTES,
    requiredBytes,
    limitBytes: TREE_COMPLETE_PUBLIC_RESPONSE_MAX_BYTES,
  }
}

function maximizeActiveRunLifecycles(workspace: Workspace): void {
  for (const run of workspace.runs) {
    if (!isRunActive(run)) continue
    const version = workspace.versions.find((candidate) => candidate.id === run.versionId)
    if (!version) continue

    // New runs retain one terminal-log slot. The +1 covers legacy active runs
    // that already reached the current log ceiling before an upgrade.
    const maximumLogCount = Math.max(MAX_RUN_LOG_ENTRIES, run.logs.length + 1)
    while (run.logs.length < maximumLogCount) {
      run.logs.push({
        id: 'f'.repeat(UUID_LENGTH),
        at: '9'.repeat(ISO_TIMESTAMP_LENGTH),
        message: maximumText(MAX_RUN_LOG_MESSAGE_LENGTH),
        tone: 'success',
      })
    }

    // This deliberately forms a superset of success and failure state. A real
    // terminal run cannot retain both fields, so its encoded form is smaller.
    run.phase = 'generating'
    run.progress = 100
    run.completedAt = '9'.repeat(ISO_TIMESTAMP_LENGTH)
    run.worktreePath = maximumText(MAX_RUN_WORKTREE_PATH_LENGTH)
    run.error = maximumText(MAX_RUN_LOG_MESSAGE_LENGTH)
    run.result = maximumEvidence()

    version.status = 'complete'
    version.commit = maximumText(MAX_RUN_RESULT_COMMIT_LENGTH)
    version.summary = maximumText(MAX_RUN_RESULT_SUMMARY_LENGTH)
    version.changedFiles = Number.MAX_SAFE_INTEGER
  }
}

function maximumEvidence(): AgentRunResult {
  return {
    changeKind: 'simulated',
    changedFileCount: Number.MAX_SAFE_INTEGER,
    changedFiles: Array.from({ length: MAX_RUN_RESULT_CHANGED_FILES }, (_, index) =>
      `${maximumText(MAX_RUN_RESULT_CHANGED_FILE_LENGTH - 2)}${index.toString(36).padStart(2, '0')}`,
    ),
    changedFilesTruncated: false,
    checks: Array.from({ length: MAX_RUN_RESULT_CHECKS }, (_, index) => ({
      id: `c${index.toString(36).padStart(2, '0')}${'x'.repeat(MAX_RUN_RESULT_CHECK_ID_LENGTH - 3)}`,
      label: maximumText(MAX_RUN_RESULT_CHECK_LABEL_LENGTH),
      detail: maximumText(MAX_RUN_RESULT_CHECK_DETAIL_LENGTH),
      status: 'simulated',
    })),
  }
}

function maximumText(length: number): string {
  return MAX_JSON_CHARACTER.repeat(length)
}
