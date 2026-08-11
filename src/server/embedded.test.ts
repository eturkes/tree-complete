import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { Workspace } from '../shared/model.js'
import type { EmbeddedService } from './embedded.js'
import { createEmbeddedService } from './embedded.js'

const directories: string[] = []
const services: EmbeddedService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) await service.close()
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })))
})

async function service(): Promise<{ dataDir: string; embedded: EmbeddedService }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'tree-complete-embedded-'))
  directories.push(dataDir)
  const embedded = await createEmbeddedService({
    targetRepo: resolve(process.cwd()),
    dataDir,
    mode: 'preview',
  })
  services.push(embedded)
  return { dataDir, embedded }
}

describe('embedded service', () => {
  it('returns the same public workspace and fork response as HTTP injection', async () => {
    const { embedded } = await service()
    const initial = await embedded.workspace()
    const decision = initial.versions[0].decisions[0]
    const alternative = decision.alternatives.find(
      (candidate) => candidate.id !== decision.chosenAlternativeId,
    )
    if (!alternative) throw new Error('Fixture decision needs an alternate choice')

    const response = await embedded.createFork({
      baseVersionId: initial.versions[0].id,
      decisionId: decision.id,
      alternativeId: alternative.id,
    })
    expect(response.runId).toBeTruthy()
    expect(response.versionId).toBeTruthy()
    const run = response.workspace.runs.at(-1)
    expect(run).toMatchObject({
      id: response.runId,
      mode: 'preview',
      phase: 'queued',
    })
    expect(run).not.toHaveProperty('worktreePath')
    expect(response.workspace.project.repository).not.toMatch(/^\//)
  })

  it('exposes bounded client errors and closes idempotently', async () => {
    const { embedded } = await service()
    await expect(
      embedded.createFork({
        baseVersionId: 'missing',
        decisionId: 'data-boundary',
        alternativeId: 'sqlite',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'The selected base version does not exist.',
    })
    await embedded.close()
    await embedded.close()
    await expect(embedded.workspace()).rejects.toMatchObject({
      statusCode: 503,
      message: 'Tree Complete service is closed.',
    })
  })

  it('waits for active work and shares concurrent close calls', async () => {
    const { dataDir, embedded } = await service()
    const initial = await embedded.workspace()
    const base = initial.versions[0]
    const decision = base.decisions[0]
    const alternative = decision.alternatives.find(
      (candidate) => candidate.id !== decision.chosenAlternativeId,
    )
    if (!alternative) throw new Error('Fixture decision needs an alternate choice')
    const responsePending = embedded.createFork({
      baseVersionId: base.id,
      decisionId: decision.id,
      alternativeId: alternative.id,
    })

    const closing = embedded.close()
    expect(embedded.close()).toBe(closing)
    const response = await responsePending
    await closing

    const stateFiles = (await readdir(dataDir)).filter((name) =>
      /^workspace\.preview-[0-9a-f]{12}\.json$/.test(name),
    )
    expect(stateFiles).toHaveLength(1)
    const persisted = JSON.parse(await readFile(join(dataDir, stateFiles[0]), 'utf8')) as Workspace
    expect(persisted.runs.find((run) => run.id === response.runId)?.phase).toBe('complete')
    expect(persisted.versions.find((version) => version.id === response.versionId)?.status).toBe(
      'complete',
    )
  })
})
