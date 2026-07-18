import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentRun, ProgramVersion } from '../../shared/model.js'
import {
  PROJECT_MANIFEST_PATH,
  manifestToDesignDecisions,
  readWorktreeManifest,
  type ProjectManifest,
} from '../manifest.js'
import { createSeedWorkspace } from '../seed.js'
import { CodexRunner } from './codex.js'
import type { RunTransition, RunnerContext } from './types.js'

const exec = promisify(execFile)
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })))
})

describe('CodexRunner', () => {
  it('pins a worktree, invokes a constrained Codex process, and creates the host-owned commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tree-complete-live-'))
    directories.push(root)
    const repository = join(root, 'repository')
    const dataDir = join(root, 'data')
    await exec('git', ['init', '--initial-branch=main', repository])
    await writeFile(join(repository, 'README.md'), '# fixture\n')
    const manifest = projectManifest()
    await mkdir(join(repository, '.tree-complete'))
    await writeFile(
      join(repository, PROJECT_MANIFEST_PATH),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    await exec('git', ['-C', repository, 'add', '--all'])
    await exec('git', [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      '-C',
      repository,
      'commit',
      '--message',
      'fixture',
    ])
    const { stdout } = await exec('git', ['-C', repository, 'rev-parse', 'HEAD'])
    const baseCommit = stdout.trim()

    const fakeCodex = join(root, 'fake-codex.cjs')
    await writeFile(
      fakeCodex,
      '#!/usr/bin/env node\n' +
        "const fs = require('node:fs');\n" +
        "fs.writeFileSync('implementation.txt', 'implemented\\n');\n" +
        "fs.writeFileSync('codex-args.json', JSON.stringify(process.argv.slice(2)));\n",
    )
    await chmod(fakeCodex, 0o700)

    const seed = createSeedWorkspace({
      runner: { mode: 'codex', label: 'Codex', available: true, detail: 'Live.' },
      rootBranch: 'main',
      rootCommit: baseCommit,
      decisions: manifestToDesignDecisions(manifest),
    })
    const baseVersion = seed.versions[0]
    const decision = baseVersion.decisions[0]
    const fromAlternative = decision.alternatives[0]
    const toAlternative = decision.alternatives[1]
    const version: ProgramVersion = {
      ...structuredClone(baseVersion),
      id: 'version-id',
      parentId: baseVersion.id,
      branch: 'tree-complete/data-boundary/sqlite-test123',
      status: 'working',
      forkOrigin: {
        decisionId: decision.id,
        fromAlternativeId: fromAlternative.id,
        toAlternativeId: toAlternative.id,
      },
    }
    const run: AgentRun = {
      id: 'run-id',
      versionId: version.id,
      mode: 'codex',
      phase: 'preparing',
      progress: 10,
      startedAt: new Date().toISOString(),
      logs: [],
    }
    const transitions: RunTransition[] = []
    let worktree = ''
    const context: RunnerContext = {
      run,
      version,
      baseVersion,
      decision,
      fromAlternative,
      toAlternative,
      transition: async (transition) => {
        transitions.push(transition)
      },
      setWorktree: async (path) => {
        worktree = path
      },
      diagnostic: () => undefined,
    }

    const result = await new CodexRunner({
      repository,
      dataDir,
      codexExecutable: fakeCodex,
      timeoutMs: 5_000,
    }).run(context)

    expect(result.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(result.commit).not.toBe(baseCommit)
    expect(result.changedFiles).toBe(3)
    expect(transitions.map((transition) => transition.phase)).toEqual([
      'preparing',
      'generating',
      'verifying',
    ])
    const args = JSON.parse(await readFile(join(worktree, 'codex-args.json'), 'utf8')) as string[]
    expect(args).toContain('--ignore-user-config')
    expect(args).toContain('never')
    expect(args).toContain('workspace-write')
    const log = await exec('git', ['-C', worktree, 'show', '-s', '--format=%an <%ae>', 'HEAD'])
    expect(log.stdout.trim()).toBe('Tree Complete <tree-complete@localhost>')
    expect((await readWorktreeManifest(worktree)).decisions[0].chosenAlternativeId).toBe('sqlite')
    const parent = await exec('git', ['-C', worktree, 'rev-parse', 'HEAD^'])
    expect(parent.stdout.trim()).toBe(baseCommit)
  })
})

function projectManifest(): ProjectManifest {
  return {
    schemaVersion: 1,
    project: {
      id: 'fixture',
      name: 'Fixture',
      description: 'Codex runner integration fixture.',
    },
    decisions: [
      {
        id: 'data-boundary',
        title: 'Data boundary',
        question: 'Where should state live?',
        rationale: 'Persistence controls recovery behavior.',
        chosenAlternativeId: 'local-json',
        alternatives: [
          {
            id: 'local-json',
            label: 'Local JSON',
            description: 'Keep state in one local document.',
            impact: 'Simple single-process operation.',
            signal: 'recommended',
            brief: {
              objective: 'Keep atomic local state.',
              constraints: ['Preserve the public model.'],
              acceptance: ['State survives restart.'],
            },
          },
          {
            id: 'sqlite',
            label: 'SQLite',
            description: 'Use an embedded relational store.',
            impact: 'Transactional queries with one extra dependency.',
            signal: 'balanced',
            brief: {
              objective: 'Move state into SQLite.',
              constraints: ['Preserve the public model.'],
              acceptance: ['Existing state behavior remains covered.'],
            },
          },
        ],
      },
    ],
  }
}
