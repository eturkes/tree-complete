import { basename } from 'node:path'

import type { Workspace } from '../shared/model.js'

export function publicWorkspace(
  workspace: Workspace,
  privatePaths: readonly (string | undefined)[],
): Workspace {
  const copy = structuredClone(workspace)
  if (copy.project.repository.startsWith('/')) {
    copy.project.repository = `git:${basename(copy.project.repository)}`
  }
  const replacements = privatePaths.filter((value): value is string => Boolean(value))
  for (const run of copy.runs) {
    delete run.worktreePath
    if (run.error) run.error = redact(run.error, replacements)
    for (const entry of run.logs) entry.message = redact(entry.message, replacements)
  }
  return copy
}

function redact(value: string, replacements: readonly string[]): string {
  return replacements.reduce((result, path) => result.replaceAll(path, redactionLabel(path)), value)
}

function redactionLabel(path: string): string {
  const label = '[local path]'
  return jsonStringContentBytes(label) <= jsonStringContentBytes(path)
    ? label
    : '*'.repeat(Array.from(path).length)
}

function jsonStringContentBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value)) - 2
}
