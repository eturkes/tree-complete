import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentRun, ProgramVersion, RunnerDescriptor } from '../shared/model.js'
import { createSeedWorkspace } from './seed.js'
import { WorkspaceStore } from './store.js'

const directories: string[] = []
const runner: RunnerDescriptor = {
  mode: 'preview',
  label: 'Test runner',
  available: true,
  detail: 'Test runner.',
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })))
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'tree-complete-store-'))
  directories.push(path)
  return path
}

describe('WorkspaceStore', () => {
  it('serializes mutations and atomically leaves valid JSON', async () => {
    const dataDir = await directory()
    const store = await WorkspaceStore.open({
      dataDir,
      stateKey: 'test',
      seed: () => createSeedWorkspace({ runner }),
      runner,
    })

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.update((workspace) => {
          workspace.project.description = `${workspace.project.description}|${index}`
        }),
      ),
    )

    const persisted = JSON.parse(await readFile(store.statePath, 'utf8'))
    expect(persisted.project.description.match(/\|/g)).toHaveLength(8)
    expect((await readdir(dataDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('recovers interrupted active runs as failed on startup', async () => {
    const dataDir = await directory()
    const options = {
      dataDir,
      stateKey: 'recovery',
      seed: () => createSeedWorkspace({ runner }),
      runner,
    }
    const store = await WorkspaceStore.open(options)
    const version: ProgramVersion = {
      ...structuredClone((await store.snapshot()).versions[0]),
      id: 'child',
      parentId: 'root',
      status: 'working',
      runId: 'run',
    }
    const run: AgentRun = {
      id: 'run',
      versionId: 'child',
      mode: 'preview',
      phase: 'generating',
      progress: 55,
      startedAt: '2026-01-01T00:00:00.000Z',
      logs: [],
    }
    await store.update((workspace) => {
      workspace.versions.push(version)
      workspace.runs.push(run)
    })

    const reopened = await WorkspaceStore.open(options)
    const workspace = await reopened.snapshot()
    expect(workspace.runs[0]).toMatchObject({
      phase: 'failed',
      progress: 55,
      error: expect.stringContaining('restarted'),
      completedAt: expect.any(String),
    })
    expect(workspace.versions.find((candidate) => candidate.id === 'child')?.status).toBe('failed')
  })
})
