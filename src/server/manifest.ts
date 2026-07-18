import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import type { AlternativeSignal, DesignDecision } from '../shared/model.js'
import { execFileChecked } from './process.js'

export const PROJECT_MANIFEST_PATH = '.tree-complete/project.json'
export const MAX_PROJECT_MANIFEST_BYTES = 256 * 1024

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const MAX_DECISIONS = 64
const MAX_ALTERNATIVES = 24
const MAX_BRIEF_ITEMS = 32

export interface ProjectManifestBrief {
  objective: string
  constraints: string[]
  acceptance: string[]
}

export interface ProjectManifestAlternative {
  id: string
  label: string
  description: string
  impact: string
  signal: AlternativeSignal
  brief: ProjectManifestBrief
}

export interface ProjectManifestDecision {
  id: string
  title: string
  question: string
  rationale: string
  chosenAlternativeId: string
  alternatives: ProjectManifestAlternative[]
}

export interface ProjectManifest {
  schemaVersion: 1
  project: {
    id: string
    name: string
    description: string
  }
  decisions: ProjectManifestDecision[]
}

export class ProjectManifestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProjectManifestError'
  }
}

export function parseProjectManifest(input: unknown): ProjectManifest {
  let value = input
  if (typeof input === 'string') {
    assertEncodedSize(input)
    try {
      value = JSON.parse(input) as unknown
    } catch (error) {
      throw new ProjectManifestError('Project manifest is not valid JSON.', { cause: error })
    }
  }

  const root = record(value, 'manifest', ['schemaVersion', 'project', 'decisions'])
  if (root.schemaVersion !== 1) {
    throw new ProjectManifestError('manifest.schemaVersion must equal 1.')
  }

  const projectRecord = record(root.project, 'manifest.project', ['id', 'name', 'description'])
  const project = {
    id: slug(projectRecord.id, 'manifest.project.id'),
    name: text(projectRecord.name, 'manifest.project.name', 120),
    description: text(projectRecord.description, 'manifest.project.description', 2_000),
  }

  const decisionValues = array(root.decisions, 'manifest.decisions', 1, MAX_DECISIONS)
  const decisionIds = new Set<string>()
  const decisions = decisionValues.map((decisionValue, decisionIndex) => {
    const path = `manifest.decisions[${decisionIndex}]`
    const decisionRecord = record(decisionValue, path, [
      'id',
      'title',
      'question',
      'rationale',
      'chosenAlternativeId',
      'alternatives',
    ])
    const id = slug(decisionRecord.id, `${path}.id`)
    unique(decisionIds, id, `${path}.id`)

    const alternativeValues = array(
      decisionRecord.alternatives,
      `${path}.alternatives`,
      2,
      MAX_ALTERNATIVES,
    )
    const alternativeIds = new Set<string>()
    const alternatives = alternativeValues.map((alternativeValue, alternativeIndex) => {
      const alternativePath = `${path}.alternatives[${alternativeIndex}]`
      const alternativeRecord = record(alternativeValue, alternativePath, [
        'id',
        'label',
        'description',
        'impact',
        'signal',
        'brief',
      ])
      const alternativeId = slug(alternativeRecord.id, `${alternativePath}.id`)
      unique(alternativeIds, alternativeId, `${alternativePath}.id`)
      const briefRecord = record(alternativeRecord.brief, `${alternativePath}.brief`, [
        'objective',
        'constraints',
        'acceptance',
      ])

      return {
        id: alternativeId,
        label: text(alternativeRecord.label, `${alternativePath}.label`, 120),
        description: text(
          alternativeRecord.description,
          `${alternativePath}.description`,
          1_000,
        ),
        impact: text(alternativeRecord.impact, `${alternativePath}.impact`, 1_000),
        signal: signal(alternativeRecord.signal, `${alternativePath}.signal`),
        brief: {
          objective: text(briefRecord.objective, `${alternativePath}.brief.objective`, 2_000),
          constraints: textArray(
            briefRecord.constraints,
            `${alternativePath}.brief.constraints`,
          ),
          acceptance: textArray(
            briefRecord.acceptance,
            `${alternativePath}.brief.acceptance`,
          ),
        },
      }
    })

    const chosenAlternativeId = slug(
      decisionRecord.chosenAlternativeId,
      `${path}.chosenAlternativeId`,
    )
    if (!alternativeIds.has(chosenAlternativeId)) {
      throw new ProjectManifestError(
        `${path}.chosenAlternativeId must identify an alternative on that decision.`,
      )
    }

    return {
      id,
      title: text(decisionRecord.title, `${path}.title`, 120),
      question: text(decisionRecord.question, `${path}.question`, 500),
      rationale: text(decisionRecord.rationale, `${path}.rationale`, 2_000),
      chosenAlternativeId,
      alternatives,
    }
  })

  const manifest: ProjectManifest = { schemaVersion: 1, project, decisions }
  assertEncodedSize(JSON.stringify(manifest))
  return manifest
}

export function manifestToDesignDecisions(manifest: ProjectManifest): DesignDecision[] {
  const validated = parseProjectManifest(manifest)
  return validated.decisions.map((decision) => ({
    id: decision.id,
    title: decision.title,
    question: decision.question,
    rationale: decision.rationale,
    chosenAlternativeId: decision.chosenAlternativeId,
    alternatives: decision.alternatives.map((alternative) => ({
      id: alternative.id,
      label: alternative.label,
      description: alternative.description,
      impact: alternative.impact,
      signal: alternative.signal,
      agentBrief: renderBrief(alternative.brief),
    })),
  }))
}

export async function readProjectManifestAtCommit(
  repository: string,
  commit: string,
): Promise<ProjectManifest> {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(commit)) {
    throw new ProjectManifestError('Manifest commit must be a full 40- or 64-digit Git object ID.')
  }

  const resolvedCommit = (
    await execFileChecked('git', ['--no-pager', '-C', repository, 'rev-parse', '--verify', `${commit}^{commit}`], {
      maxCaptureBytes: 256,
      timeoutMs: 15_000,
    })
  ).stdout.trim()
  if (resolvedCommit.toLowerCase() !== commit.toLowerCase()) {
    throw new ProjectManifestError('Manifest commit must be the repository’s full commit ID.')
  }

  const result = await execFileChecked(
    'git',
    [
      '--no-pager',
      '-C',
      repository,
      'show',
      '--no-ext-diff',
      '--no-textconv',
      `${resolvedCommit}:${PROJECT_MANIFEST_PATH}`,
    ],
    { maxCaptureBytes: MAX_PROJECT_MANIFEST_BYTES + 1, timeoutMs: 15_000 },
  )
  assertEncodedSize(result.stdout)
  return parseProjectManifest(result.stdout)
}

export async function readWorktreeManifest(worktree: string): Promise<ProjectManifest> {
  const location = await resolveWorktreeManifest(worktree)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(location.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const metadata = await handle.stat()
    if (!metadata.isFile()) {
      throw new ProjectManifestError('Worktree project manifest must be a regular file.')
    }
    if (metadata.size < 1 || metadata.size > MAX_PROJECT_MANIFEST_BYTES) {
      throw new ProjectManifestError(
        `Worktree project manifest must be 1-${MAX_PROJECT_MANIFEST_BYTES} bytes.`,
      )
    }
    const source = await handle.readFile({ encoding: 'utf8' })
    assertEncodedSize(source)
    return parseProjectManifest(source)
  } catch (error) {
    if (error instanceof ProjectManifestError) throw error
    throw new ProjectManifestError('Could not safely read the worktree project manifest.', {
      cause: error,
    })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export function selectManifestAlternative(
  base: ProjectManifest,
  decisionId: string,
  alternativeId: string,
): ProjectManifest {
  const selected = structuredClone(parseProjectManifest(base))
  const decision = selected.decisions.find((candidate) => candidate.id === decisionId)
  if (!decision) {
    throw new ProjectManifestError(`Manifest decision ${JSON.stringify(decisionId)} does not exist.`)
  }
  if (!decision.alternatives.some((candidate) => candidate.id === alternativeId)) {
    throw new ProjectManifestError(
      `Manifest alternative ${JSON.stringify(alternativeId)} does not exist on ${JSON.stringify(decisionId)}.`,
    )
  }
  decision.chosenAlternativeId = alternativeId
  return selected
}

export async function writeWorktreeManifestSelection(
  worktree: string,
  expectedBase: ProjectManifest,
  decisionId: string,
  alternativeId: string,
): Promise<ProjectManifest> {
  const current = await readWorktreeManifest(worktree)
  assertManifestMatchesExpected(current, expectedBase)
  const expected = selectManifestAlternative(expectedBase, decisionId, alternativeId)
  const location = await resolveWorktreeManifest(worktree)
  const serialized = `${JSON.stringify(expected, null, 2)}\n`
  assertEncodedSize(serialized)
  const temporaryPath = join(
    location.directory,
    `.project.${process.pid}.${randomUUID()}.tmp`,
  )
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, location.path)
  } catch (error) {
    throw new ProjectManifestError('Could not safely write the worktree project manifest.', {
      cause: error,
    })
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }

  const written = await readWorktreeManifest(worktree)
  assertManifestMatchesExpected(written, expected)
  return written
}

export function assertManifestMatchesExpected(
  actual: ProjectManifest,
  expected: ProjectManifest,
): void {
  const validatedActual = parseProjectManifest(actual)
  const validatedExpected = parseProjectManifest(expected)
  if (!isDeepStrictEqual(validatedActual, validatedExpected)) {
    throw new ProjectManifestError('Result manifest differs from the host-expected design state.')
  }
}

export async function assertWorktreeManifestMatches(
  worktree: string,
  expected: ProjectManifest,
): Promise<void> {
  assertManifestMatchesExpected(await readWorktreeManifest(worktree), expected)
}

interface WorktreeManifestLocation {
  directory: string
  path: string
}

async function resolveWorktreeManifest(worktree: string): Promise<WorktreeManifestLocation> {
  const requestedRoot = resolve(worktree)
  const requestedRootMetadata = await lstat(requestedRoot)
  if (!requestedRootMetadata.isDirectory() || requestedRootMetadata.isSymbolicLink()) {
    throw new ProjectManifestError('Manifest worktree must be a real directory.')
  }
  const root = await realpath(requestedRoot)
  const directory = join(root, '.tree-complete')
  const directoryMetadata = await lstat(directory)
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new ProjectManifestError('Worktree .tree-complete must be a real directory.')
  }
  const canonicalDirectory = await realpath(directory)
  const fromRoot = relative(root, canonicalDirectory)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new ProjectManifestError('Worktree manifest directory escapes the worktree root.')
  }
  const path = join(canonicalDirectory, 'project.json')
  const manifestMetadata = await lstat(path)
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
    throw new ProjectManifestError('Worktree project manifest must be a real regular file.')
  }
  return { directory: canonicalDirectory, path }
}

function renderBrief(brief: ProjectManifestBrief): string {
  return [
    `Objective:\n${brief.objective}`,
    `Constraints:\n${brief.constraints.map((item) => `- ${item}`).join('\n')}`,
    `Acceptance criteria:\n${brief.acceptance.map((item) => `- ${item}`).join('\n')}`,
  ].join('\n\n')
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectManifestError(`${path} must be an object.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProjectManifestError(`${path} must be a plain object.`)
  }
  const result = value as Record<string, unknown>
  const allowed = new Set(keys)
  const extra = Object.keys(result).find((key) => !allowed.has(key))
  if (extra) throw new ProjectManifestError(`${path} contains unsupported field ${JSON.stringify(extra)}.`)
  return result
}

function array(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ProjectManifestError(`${path} must contain ${minimum}-${maximum} items.`)
  }
  return value
}

function text(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    value.length > maximum
  ) {
    throw new ProjectManifestError(`${path} must be a non-empty string of at most ${maximum} characters.`)
  }
  return value
}

function slug(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new ProjectManifestError(`${path} must match ${ID_PATTERN}.`)
  }
  return value
}

function signal(value: unknown, path: string): AlternativeSignal {
  if (value !== 'recommended' && value !== 'balanced' && value !== 'experimental') {
    throw new ProjectManifestError(
      `${path} must be "recommended", "balanced", or "experimental".`,
    )
  }
  return value
}

function textArray(value: unknown, path: string): string[] {
  return array(value, path, 1, MAX_BRIEF_ITEMS).map((item, index) =>
    text(item, `${path}[${index}]`, 1_000),
  )
}

function unique(seen: Set<string>, id: string, path: string): void {
  if (seen.has(id)) throw new ProjectManifestError(`${path} duplicates ID ${JSON.stringify(id)}.`)
  seen.add(id)
}

function assertEncodedSize(source: string): void {
  const size = Buffer.byteLength(source, 'utf8')
  if (size < 1 || size > MAX_PROJECT_MANIFEST_BYTES) {
    throw new ProjectManifestError(
      `Project manifest must be 1-${MAX_PROJECT_MANIFEST_BYTES} UTF-8 bytes.`,
    )
  }
}
