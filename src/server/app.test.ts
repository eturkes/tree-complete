import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { CreateForkResponse, Workspace } from '../shared/model.js'
import { createApp } from './app.js'
import { execFileChecked } from './process.js'
import type { AgentRunner } from './runners/types.js'

const directories: string[] = []
const apps: Awaited<ReturnType<typeof createApp>>[] = []

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.forkOrchestrator.waitForIdle()
    await app.close()
  }
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })))
})

async function testApp(delay = 40) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tree-complete-api-'))
  directories.push(dataDir)
  const app = await createApp({
    config: { agentMode: 'preview', dataDir, previewPhaseDelayMs: delay },
  })
  apps.push(app)
  return app
}

describe('HTTP API', () => {
  it('serves health and the deterministic seeded workspace', async () => {
    const app = await testApp()

    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({
      status: 'ready',
      runner: { mode: 'preview', available: true },
    })
    expect(health.headers['cache-control']).toBe('no-store')

    const first = await app.inject({ method: 'GET', url: '/api/workspace' })
    const second = await app.inject({ method: 'GET', url: '/api/workspace' })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toEqual(second.json())
    const workspace = first.json<Workspace>()
    expect(workspace.runner).toMatchObject({ mode: 'preview', available: true })
    expect(workspace.versions).toHaveLength(1)
    expect(workspace.versions[0].decisions).toHaveLength(4)
    expect(workspace.versions[0].decisions.every((decision) => decision.alternatives.length >= 3)).toBe(
      true,
    )
  })

  it('rejects non-loopback Host and mutation Origin headers', async () => {
    const app = await testApp()
    const foreignHost = await app.inject({
      method: 'GET',
      url: '/api/workspace',
      headers: { host: 'tree-complete.attacker.example:4318' },
    })
    expect(foreignHost.statusCode).toBe(403)
    expect(foreignHost.json()).toMatchObject({ error: 'invalid_host' })

    const foreignOrigin = await app.inject({
      method: 'POST',
      url: '/api/forks',
      headers: { origin: 'https://attacker.example' },
      payload: {
        baseVersionId: 'root',
        decisionId: 'data-boundary',
        alternativeId: 'sqlite',
      },
    })
    expect(foreignOrigin.statusCode).toBe(403)
    expect(foreignOrigin.json()).toMatchObject({ error: 'invalid_origin' })
    await expect(createApp({ config: { host: '0.0.0.0' } })).rejects.toThrow(
      /must be a loopback host/,
    )
  })

  it('loads live decisions from the exact committed manifest, not the dirty checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tree-complete-live-app-'))
    directories.push(root)
    const repository = join(root, 'repository')
    await mkdir(repository)
    await git(repository, ['init', '--initial-branch=main'])
    await mkdir(join(repository, '.tree-complete'))
    await writeFile(
      join(repository, '.tree-complete/project.json'),
      await readFile(resolve(process.cwd(), '.tree-complete/project.json'), 'utf8'),
    )
    await git(repository, ['add', '--all'])
    await git(repository, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit',
      '--message',
      'fixture manifest',
    ])
    const commit = (await git(repository, ['rev-parse', 'HEAD'])).trim()
    await writeFile(join(repository, '.tree-complete/project.json'), '{"dirty":true}\n')

    const app = await createApp({
      config: { agentMode: 'codex', dataDir: join(root, 'state'), targetRepo: repository },
    })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/workspace' })
    const workspace = response.json<Workspace>()
    expect(workspace.project).toMatchObject({
      id: 'tree-complete',
      repository: 'git:tree-complete',
    })
    expect(workspace.versions[0]).toMatchObject({ commit, branch: 'main' })
    expect(workspace.versions[0].decisions).toHaveLength(4)
  })

  it('refuses live mode when the target commit has no project manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tree-complete-missing-manifest-'))
    directories.push(root)
    const repository = join(root, 'repository')
    await mkdir(repository)
    await git(repository, ['init', '--initial-branch=main'])
    await git(repository, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit',
      '--allow-empty',
      '--message',
      'empty fixture',
    ])

    await expect(
      createApp({
        config: { agentMode: 'codex', dataDir: join(root, 'state'), targetRepo: repository },
      }),
    ).rejects.toThrow(/project\.json|path .* does not exist/i)
  })

  it.each([
    [{}, 400, 'invalid_request'],
    [{ baseVersionId: 'missing', decisionId: 'data-boundary', alternativeId: 'sqlite' }, 404, 'base_version_not_found'],
    [{ baseVersionId: 'root', decisionId: 'missing', alternativeId: 'sqlite' }, 404, 'decision_not_found'],
    [{ baseVersionId: 'root', decisionId: 'data-boundary', alternativeId: 'missing' }, 404, 'alternative_not_found'],
    [{ baseVersionId: 'root', decisionId: 'data-boundary', alternativeId: 'local-json' }, 409, 'alternative_already_selected'],
    [{ baseVersionId: 'root', decisionId: 'data-boundary', alternativeId: 'sqlite', agentBrief: 'untrusted' }, 400, 'invalid_request'],
  ] as const)('validates a fork request %#', async (payload, statusCode, error) => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/api/forks', payload })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json()).toMatchObject({ error })
  })

  it('atomically reserves one copy of an active fork', async () => {
    const app = await testApp(100)
    const payload = {
      baseVersionId: 'root',
      decisionId: 'data-boundary',
      alternativeId: 'sqlite',
    }

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/api/forks', payload }),
      app.inject({ method: 'POST', url: '/api/forks', payload }),
    ])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([202, 409])
    expect(responses.find((response) => response.statusCode === 409)?.json()).toMatchObject({
      error: 'fork_already_active',
    })
  })

  it('clones the base, changes one choice, and completes the preview asynchronously', async () => {
    const app = await testApp(5)
    const response = await app.inject({
      method: 'POST',
      url: '/api/forks',
      payload: {
        baseVersionId: 'root',
        decisionId: 'data-boundary',
        alternativeId: 'sqlite',
      },
    })
    expect(response.statusCode).toBe(202)
    const created = response.json<CreateForkResponse>()
    const queuedVersion = created.workspace.versions.find(
      (version) => version.id === created.versionId,
    )
    expect(queuedVersion).toMatchObject({ parentId: 'root', status: 'queued' })
    expect(created.workspace.runs.find((run) => run.id === created.runId)?.result).toBeUndefined()
    expect(
      queuedVersion?.decisions.find((decision) => decision.id === 'data-boundary')
        ?.chosenAlternativeId,
    ).toBe('sqlite')
    expect(
      created.workspace.versions[0].decisions.find((decision) => decision.id === 'data-boundary')
        ?.chosenAlternativeId,
    ).toBe('local-json')

    await app.forkOrchestrator.waitForIdle()
    const workspaceResponse = await app.inject({ method: 'GET', url: '/api/workspace' })
    const workspace = workspaceResponse.json<Workspace>()
    const completedRun = workspace.runs.find((run) => run.id === created.runId)
    expect(completedRun).toMatchObject({
      phase: 'complete',
      progress: 100,
      result: {
        changeKind: 'simulated',
        changedFileCount: expect.any(Number),
        changedFiles: [],
        changedFilesTruncated: false,
        checks: [
          {
            id: 'preview-simulation',
            status: 'simulated',
          },
        ],
      },
    })
    const completedVersion = workspace.versions.find((version) => version.id === created.versionId)
    expect(completedVersion).toMatchObject({
      status: 'complete',
      changedFiles: expect.any(Number),
      commit: expect.stringMatching(/^preview-/),
    })
    expect(completedVersion?.changedFiles).toBe(completedRun?.result?.changedFileCount)

    const dataDir = app.treeCompleteConfig.dataDir
    apps.splice(apps.indexOf(app), 1)
    await app.close()
    const reopened = await createApp({
      config: { agentMode: 'preview', dataDir, previewPhaseDelayMs: 5 },
    })
    apps.push(reopened)
    const persisted = (await reopened.inject({ method: 'GET', url: '/api/workspace' })).json<Workspace>()
    expect(persisted.runs.find((run) => run.id === created.runId)?.result).toEqual(completedRun?.result)
  })

  it('fails closed when a runner returns invalid public evidence', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tree-complete-invalid-evidence-'))
    directories.push(dataDir)
    const runner: AgentRunner = {
      mode: 'preview',
      async run() {
        return {
          commit: 'preview-invalid',
          summary: 'Invalid evidence fixture.',
          evidence: {
            changeKind: 'simulated',
            changedFileCount: -1,
            changedFiles: [],
            changedFilesTruncated: false,
            checks: [{
              id: 'preview-simulation',
              label: 'Preview simulation',
              detail: 'Fixture.',
              status: 'simulated',
            }],
          },
        }
      },
    }
    const app = await createApp({ config: { agentMode: 'preview', dataDir }, runner })
    apps.push(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/forks',
      payload: {
        baseVersionId: 'root',
        decisionId: 'data-boundary',
        alternativeId: 'sqlite',
      },
    })
    const created = response.json<CreateForkResponse>()
    await app.forkOrchestrator.waitForIdle()
    const workspace = (await app.inject({ method: 'GET', url: '/api/workspace' })).json<Workspace>()
    const failedRun = workspace.runs.find((run) => run.id === created.runId)
    expect(failedRun).toMatchObject({
      phase: 'failed',
      error: expect.stringMatching(/invalid result evidence/i),
    })
    expect(failedRun?.result).toBeUndefined()
  })

  it('caps concurrent forks at two', async () => {
    const app = await testApp(100)
    const requests = [
      { decisionId: 'data-boundary', alternativeId: 'sqlite' },
      { decisionId: 'execution-isolation', alternativeId: 'full-clone' },
      { decisionId: 'agent-feedback', alternativeId: 'result-only' },
    ]
    const responses = []
    for (const request of requests) {
      responses.push(
        await app.inject({
          method: 'POST',
          url: '/api/forks',
          payload: { baseVersionId: 'root', ...request },
        }),
      )
    }
    expect(responses.map((response) => response.statusCode)).toEqual([202, 202, 429])
    expect(responses[2].json()).toMatchObject({ error: 'active_run_limit_reached' })
  })
})

async function git(repository: string, args: readonly string[]): Promise<string> {
  return (
    await execFileChecked('git', ['-C', repository, ...args], { timeoutMs: 15_000 })
  ).stdout
}
