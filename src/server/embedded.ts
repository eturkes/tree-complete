import type { LightMyRequestResponse } from 'fastify'

import type {
  CreateForkRequest,
  CreateForkResponse,
  RunnerMode,
  Workspace,
} from '../shared/model.js'
export { TREE_COMPLETE_PUBLIC_RESPONSE_MAX_BYTES } from '../shared/model.js'
import { createApp } from './app.js'
import { inspectGitRepository } from './git.js'
import { readProjectManifestAtCommit } from './manifest.js'

export interface EmbeddedServiceOptions {
  targetRepo: string
  dataDir: string
  mode?: RunnerMode
}

export interface EmbeddedService {
  workspace(): Promise<Workspace>
  createFork(request: CreateForkRequest): Promise<CreateForkResponse>
  close(): Promise<void>
}

export class EmbeddedServiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'EmbeddedServiceError'
  }
}

export async function preflightProjectManifest(targetRepo: string): Promise<void> {
  const repository = await inspectGitRepository(targetRepo)
  await readProjectManifestAtCommit(repository.root, repository.commit)
}

export async function createEmbeddedService(
  options: EmbeddedServiceOptions,
): Promise<EmbeddedService> {
  const app = await createApp({
    config: {
      agentMode: options.mode ?? 'preview',
      targetRepo: options.targetRepo,
      dataDir: options.dataDir,
    },
    serveClient: false,
  })
  let closed = false
  let closing: Promise<void> | undefined
  const operations = new Set<Promise<unknown>>()

  const assertOpen = () => {
    if (closed) throw new EmbeddedServiceError(503, 'Tree Complete service is closed.')
  }
  const track = <T>(operation: () => Promise<T>): Promise<T> => {
    assertOpen()
    const pending = operation()
    operations.add(pending)
    void pending.then(
      () => operations.delete(pending),
      () => operations.delete(pending),
    )
    return pending
  }

  return {
    async workspace(): Promise<Workspace> {
      return await track(async () =>
        await responseBody<Workspace>(
          await app.inject({
            method: 'GET',
            url: '/api/workspace',
            headers: { host: '127.0.0.1' },
          }),
        ),
      )
    },

    async createFork(request: CreateForkRequest): Promise<CreateForkResponse> {
      return await track(async () =>
        await responseBody<CreateForkResponse>(
          await app.inject({
            method: 'POST',
            url: '/api/forks',
            headers: { host: '127.0.0.1' },
            payload: request,
          }),
        ),
      )
    },

    close(): Promise<void> {
      if (closing) return closing
      closed = true
      closing = (async () => {
        await Promise.allSettled([...operations])
        await app.forkOrchestrator.waitForIdle()
        await app.close()
      })()
      return closing
    },
  }
}

async function responseBody<T>(response: LightMyRequestResponse): Promise<T> {
  let payload: unknown
  try {
    payload = response.json<unknown>()
  } catch {
    throw new EmbeddedServiceError(502, 'Tree Complete returned an invalid response.')
  }
  if (response.statusCode >= 400) {
    const detail =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).detail === 'string'
        ? (payload as Record<string, string>).detail
        : 'Tree Complete could not complete the request.'
    throw new EmbeddedServiceError(response.statusCode, detail)
  }
  return payload as T
}
