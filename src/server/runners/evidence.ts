import {
  MAX_RUN_RESULT_CHANGED_FILES,
  MAX_RUN_RESULT_CHANGED_FILE_LENGTH,
  type AgentRunResult,
  type RunCheckStatus,
  type RunnerMode,
} from '../../shared/model.js'

const MAX_CHECKS = 16
const MAX_CHECK_ID_LENGTH = 64
const MAX_CHECK_LABEL_LENGTH = 120
const MAX_CHECK_DETAIL_LENGTH = 500
const UNSAFE_PUBLIC_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

export function validateRunnerEvidence(value: unknown, mode: RunnerMode): AgentRunResult {
  const evidence = record(value, 'evidence')
  const changeKind = evidence.changeKind === 'estimated' && mode === 'preview'
    ? 'simulated'
    : evidence.changeKind
  if (changeKind !== 'measured' && changeKind !== 'simulated') {
    throw invalidEvidence('changeKind is invalid')
  }
  if ((mode === 'codex' && changeKind !== 'measured') || (mode === 'preview' && changeKind !== 'simulated')) {
    throw invalidEvidence(`changeKind does not match ${mode} mode`)
  }

  const changedFileCount = evidence.changedFileCount
  if (!Number.isSafeInteger(changedFileCount) || (changedFileCount as number) < 0) {
    throw invalidEvidence('changedFileCount must be a non-negative safe integer')
  }
  if (!Array.isArray(evidence.changedFiles) || evidence.changedFiles.length > MAX_RUN_RESULT_CHANGED_FILES) {
    throw invalidEvidence('changedFiles exceeds its public bound')
  }
  const changedFiles = evidence.changedFiles.map((path, index) =>
    boundedPublicText(path, `changedFiles[${index}]`, MAX_RUN_RESULT_CHANGED_FILE_LENGTH),
  )
  for (const [index, path] of changedFiles.entries()) {
    const segments = path.split('/')
    if (
      path.startsWith('/') ||
      path.startsWith('\\') ||
      /^[a-z]:[\\/]/i.test(path) ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw invalidEvidence(`changedFiles[${index}] is not a safe repository-relative label`)
    }
  }
  if (new Set(changedFiles).size !== changedFiles.length) {
    throw invalidEvidence('changedFiles contains duplicate labels')
  }
  if (changedFiles.length > (changedFileCount as number)) {
    throw invalidEvidence('changedFiles exceeds changedFileCount')
  }
  if (typeof evidence.changedFilesTruncated !== 'boolean') {
    throw invalidEvidence('changedFilesTruncated must be boolean')
  }
  if (changeKind === 'measured' && evidence.changedFilesTruncated !== ((changedFileCount as number) > changedFiles.length)) {
    throw invalidEvidence('measured changed-file truncation is inconsistent')
  }
  if (changeKind === 'simulated' && (changedFiles.length > 0 || evidence.changedFilesTruncated)) {
    throw invalidEvidence('simulated evidence cannot claim repository paths')
  }

  if (!Array.isArray(evidence.checks) || evidence.checks.length < 1 || evidence.checks.length > MAX_CHECKS) {
    throw invalidEvidence('checks must contain 1-16 entries')
  }
  const checkIds = new Set<string>()
  const checks = evidence.checks.map((candidate, index) => {
    const check = record(candidate, `checks[${index}]`)
    const id = boundedPublicText(check.id, `checks[${index}].id`, MAX_CHECK_ID_LENGTH)
    if (!/^[a-z][a-z0-9-]*$/.test(id) || checkIds.has(id)) {
      throw invalidEvidence(`checks[${index}].id must be a unique lowercase slug`)
    }
    checkIds.add(id)
    const status = check.status
    if (status !== 'passed' && status !== 'simulated') {
      throw invalidEvidence(`checks[${index}].status is invalid`)
    }
    if ((mode === 'codex' && status !== 'passed') || (mode === 'preview' && status !== 'simulated')) {
      throw invalidEvidence(`checks[${index}].status does not match ${mode} mode`)
    }
    return {
      id,
      label: boundedPublicText(check.label, `checks[${index}].label`, MAX_CHECK_LABEL_LENGTH),
      detail: boundedPublicText(check.detail, `checks[${index}].detail`, MAX_CHECK_DETAIL_LENGTH),
      status: status as RunCheckStatus,
    }
  })

  return {
    changeKind,
    changedFileCount: changedFileCount as number,
    changedFiles,
    changedFilesTruncated: evidence.changedFilesTruncated,
    checks,
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEvidence(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function boundedPublicText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length < 1 || Array.from(value).length > maxLength) {
    throw invalidEvidence(`${field} must contain 1-${maxLength} characters`)
  }
  if (UNSAFE_PUBLIC_TEXT.test(value)) throw invalidEvidence(`${field} contains unsafe characters`)
  return value
}

function invalidEvidence(detail: string): Error {
  return new Error(`Runner returned invalid result evidence: ${detail}.`)
}
