import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MAX_PROJECT_MANIFEST_BYTES,
  PROJECT_MANIFEST_PATH,
  assertManifestMatchesExpected,
  assertWorktreeManifestMatches,
  manifestToDesignDecisions,
  parseProjectManifest,
  readProjectManifestAtCommit,
  readWorktreeManifest,
  selectManifestAlternative,
  writeWorktreeManifestSelection,
  type ProjectManifest,
} from './manifest.js'
import { execFileChecked } from './process.js'

const directories: string[] = []
const TRACKED_MANIFEST_URL = new URL('../../.tree-complete/project.json', import.meta.url)

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })))
})

describe('project manifest validation', () => {
  it('validates the tracked Tree Complete manifest and exposes its four decisions', async () => {
    const manifest = parseProjectManifest(await readFile(TRACKED_MANIFEST_URL, 'utf8'))
    expect(manifest.project).toMatchObject({ id: 'tree-complete', name: 'Tree Complete' })
    expect(manifest.decisions.map((decision) => decision.id)).toEqual([
      'data-boundary',
      'execution-isolation',
      'agent-feedback',
      'verification-policy',
    ])
    expect(manifestToDesignDecisions(manifest)).toHaveLength(4)
  })

  it('parses the strict schema and renders structured briefs for the existing model', () => {
    const manifest = fixture()
    expect(parseProjectManifest(JSON.stringify(manifest))).toEqual(manifest)

    const decisions = manifestToDesignDecisions(manifest)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      id: 'runtime',
      chosenAlternativeId: 'local',
    })
    expect(decisions[0].alternatives[1].agentBrief).toBe(
      [
        'Objective:\nUse a remote service.',
        'Constraints:\n- Preserve the public API.',
        'Acceptance criteria:\n- State survives a process restart.',
      ].join('\n\n'),
    )
  })

  it('rejects extra command and model configuration fields at any depth', () => {
    const rootExtra = structuredClone(fixture()) as ProjectManifest & { command?: string }
    rootExtra.command = 'arbitrary-command'
    expect(() => parseProjectManifest(rootExtra)).toThrow(/unsupported field "command"/)

    const briefExtra = structuredClone(fixture()).decisions[0].alternatives[0].brief as
      ProjectManifest['decisions'][number]['alternatives'][number]['brief'] & { model?: string }
    briefExtra.model = 'untrusted-model'
    const nestedExtra = structuredClone(fixture())
    nestedExtra.decisions[0].alternatives[0].brief = briefExtra
    expect(() => parseProjectManifest(nestedExtra)).toThrow(/unsupported field "model"/)
  })

  it('rejects duplicate decision and alternative IDs', () => {
    const duplicateDecision = structuredClone(fixture())
    duplicateDecision.decisions.push(structuredClone(duplicateDecision.decisions[0]))
    expect(() => parseProjectManifest(duplicateDecision)).toThrow(/duplicates ID "runtime"/)

    const duplicateAlternative = structuredClone(fixture())
    duplicateAlternative.decisions[0].alternatives[1].id = 'local'
    expect(() => parseProjectManifest(duplicateAlternative)).toThrow(/duplicates ID "local"/)
  })

  it('rejects a missing chosen alternative', () => {
    const manifest = structuredClone(fixture())
    manifest.decisions[0].chosenAlternativeId = 'missing'
    expect(() => parseProjectManifest(manifest)).toThrow(/must identify an alternative/)
  })

  it('rejects invalid slugs and empty or unbounded values', () => {
    const invalidSlug = structuredClone(fixture())
    invalidSlug.project.id = '../project'
    expect(() => parseProjectManifest(invalidSlug)).toThrow(/must match/)

    const emptyDecisions = structuredClone(fixture())
    emptyDecisions.decisions = []
    expect(() => parseProjectManifest(emptyDecisions)).toThrow(/must contain 1-64 items/)

    const emptyConstraints = structuredClone(fixture())
    emptyConstraints.decisions[0].alternatives[0].brief.constraints = []
    expect(() => parseProjectManifest(emptyConstraints)).toThrow(/must contain 1-32 items/)

    const longName = structuredClone(fixture())
    longName.project.name = 'x'.repeat(121)
    expect(() => parseProjectManifest(longName)).toThrow(/at most 120 characters/)

    expect(() => parseProjectManifest('x'.repeat(MAX_PROJECT_MANIFEST_BYTES + 1))).toThrow(
      /UTF-8 bytes/,
    )
  })
})

describe('project manifest Git and worktree I/O', () => {
  it('reads the exact committed manifest rather than a dirty working copy', async () => {
    const base = fixture()
    const { repository, commit } = await createRepository(base)
    const dirty = selectManifestAlternative(base, 'runtime', 'remote')
    await writeFile(manifestPath(repository), serialize(dirty), 'utf8')

    await expect(readProjectManifestAtCommit(repository, commit)).resolves.toEqual(base)
    await expect(readWorktreeManifest(repository)).resolves.toEqual(dirty)
  })

  it('writes one host-expected selection atomically and asserts the exact result', async () => {
    const base = fixture()
    const { repository } = await createRepository(base)
    const expected = selectManifestAlternative(base, 'runtime', 'remote')

    await expect(
      writeWorktreeManifestSelection(repository, base, 'runtime', 'remote'),
    ).resolves.toEqual(expected)
    await expect(assertWorktreeManifestMatches(repository, expected)).resolves.toBeUndefined()
    expect((await readFile(manifestPath(repository), 'utf8')).endsWith('\n')).toBe(true)

    const unexpected = structuredClone(expected)
    unexpected.project.description = 'Agent-modified control-plane content.'
    expect(() => assertManifestMatchesExpected(unexpected, expected)).toThrow(
      /differs from the host-expected/,
    )
  })

  it('refuses a symlinked manifest', async () => {
    const { repository } = await createRepository(fixture())
    const outsideDirectory = await directory('tree-complete-manifest-outside-')
    const outside = join(outsideDirectory, 'project.json')
    await writeFile(outside, serialize(fixture()), 'utf8')
    await rm(manifestPath(repository))
    await symlink(outside, manifestPath(repository))

    await expect(readWorktreeManifest(repository)).rejects.toThrow(/real regular file/)
  })
})

function fixture(): ProjectManifest {
  return {
    schemaVersion: 1,
    project: {
      id: 'example-project',
      name: 'Example project',
      description: 'A compact fixture for manifest behavior.',
    },
    decisions: [
      {
        id: 'runtime',
        title: 'Runtime boundary',
        question: 'Where should state live?',
        rationale: 'The boundary controls recovery and collaboration.',
        chosenAlternativeId: 'local',
        alternatives: [
          {
            id: 'local',
            label: 'Local state',
            description: 'Keep state beside the process.',
            impact: 'Simple operation with a single writer.',
            signal: 'recommended',
            brief: {
              objective: 'Keep state local.',
              constraints: ['Preserve inspectability.'],
              acceptance: ['Writes are atomic.'],
            },
          },
          {
            id: 'remote',
            label: 'Remote state',
            description: 'Move state behind a network service.',
            impact: 'Supports collaboration with more infrastructure.',
            signal: 'balanced',
            brief: {
              objective: 'Use a remote service.',
              constraints: ['Preserve the public API.'],
              acceptance: ['State survives a process restart.'],
            },
          },
        ],
      },
    ],
  }
}

async function createRepository(manifest: ProjectManifest): Promise<{
  repository: string
  commit: string
}> {
  const repository = await directory('tree-complete-manifest-repo-')
  await git(repository, ['init', '--initial-branch=main'])
  await git(repository, ['config', 'user.name', 'Manifest Test'])
  await git(repository, ['config', 'user.email', 'manifest-test@localhost'])
  await mkdir(join(repository, '.tree-complete'))
  await writeFile(manifestPath(repository), serialize(manifest), 'utf8')
  await git(repository, ['add', '--', PROJECT_MANIFEST_PATH])
  await git(repository, ['commit', '--message', 'test: add project manifest'])
  const commit = (await git(repository, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim()
  return { repository, commit }
}

async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  directories.push(path)
  return path
}

async function git(repository: string, args: readonly string[]): Promise<string> {
  return (
    await execFileChecked('git', ['-C', repository, ...args], {
      timeoutMs: 15_000,
    })
  ).stdout
}

function manifestPath(repository: string): string {
  return join(repository, PROJECT_MANIFEST_PATH)
}

function serialize(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
