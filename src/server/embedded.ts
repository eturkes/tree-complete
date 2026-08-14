import type {
  CreateForkRequest,
  CreateForkResponse,
  RunnerMode,
  Workspace,
} from '../shared/model.js'
export { TREE_COMPLETE_PUBLIC_RESPONSE_MAX_BYTES } from '../shared/model.js'
import { ApiProblem } from './errors.js'
import { inspectGitRepository } from './git.js'
import { readProjectManifestAtCommit } from './manifest.js'
import { createTreeCompleteService } from './service.js'

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
  const service = await createTreeCompleteService({
    config: {
      agentMode: options.mode ?? 'preview',
      targetRepo: options.targetRepo,
      dataDir: options.dataDir,
    },
  })

  return {
    async workspace(): Promise<Workspace> {
      return await translate(async () => await service.workspace())
    },

    async createFork(request: CreateForkRequest): Promise<CreateForkResponse> {
      return await translate(async () => await service.createFork(request))
    },

    close(): Promise<void> {
      return service.close()
    },
  }
}

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ApiProblem) {
      throw new EmbeddedServiceError(error.statusCode, error.detail ?? error.code)
    }
    if (error instanceof Error && error.message === 'Tree Complete service is closed.') {
      throw new EmbeddedServiceError(503, error.message)
    }
    throw error
  }
}
