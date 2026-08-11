import staticPlugin from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { access } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import type { ApiError, CreateForkRequest, Workspace } from '../shared/model.js'
import {
  loadServerConfig,
  runnerDescriptor,
  workspaceStateKey,
  type ServerConfig,
  type ServerConfigOverrides,
} from './config.js'
import { ApiProblem } from './errors.js'
import { inspectGitRepository, safeSlug, type GitRepositoryMetadata } from './git.js'
import {
  manifestToDesignDecisions,
  readProjectManifestAtCommit,
  readProjectManifestAtCommitIfPresent,
  type ProjectManifest,
} from './manifest.js'
import { ForkOrchestrator } from './orchestrator.js'
import { CodexRunner } from './runners/codex.js'
import { PreviewRunner } from './runners/preview.js'
import type { AgentRunner } from './runners/types.js'
import { createSeedWorkspace } from './seed.js'
import { WorkspaceStore } from './store.js'

declare module 'fastify' {
  interface FastifyInstance {
    workspaceStore: WorkspaceStore
    forkOrchestrator: ForkOrchestrator
    treeCompleteConfig: ServerConfig
  }
}

export interface CreateAppOptions {
  config?: ServerConfigOverrides
  logger?: boolean
  store?: WorkspaceStore
  runner?: AgentRunner
  seed?: () => Workspace
  serveClient?: boolean
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  let config = loadServerConfig(options.config)
  let repository: GitRepositoryMetadata | undefined
  if (config.targetRepo) {
    repository = await inspectGitRepository(config.targetRepo)
    config = { ...config, targetRepo: repository.root }
  }
  const manifest: ProjectManifest | undefined = repository
    ? config.agentMode === 'codex'
      ? await readProjectManifestAtCommit(repository.root, repository.commit)
      : await readProjectManifestAtCommitIfPresent(repository.root, repository.commit)
    : undefined
  const descriptor = repository && config.agentMode === 'preview'
    ? {
        ...runnerDescriptor(config),
        detail: manifest
          ? `Read-only simulation bound to ${repository.name} at committed HEAD ${shortCommit(repository.commit)}; target files and Git refs stay unchanged.`
          : `Read-only simulation bound to ${repository.name} at committed HEAD ${shortCommit(repository.commit)}; no committed .tree-complete/project.json exists, so decisions are generic examples and project files and Git state stay unchanged.`,
      }
    : runnerDescriptor(config)
  const genericRepositoryPreview = Boolean(
    repository && config.agentMode === 'preview' && !manifest,
  )
  const seed =
    options.seed ??
    (() =>
      createSeedWorkspace({
        runner: descriptor,
        ...(repository
          ? {
              project: {
                id: manifest?.project.id ?? safeSlug(repository.name, 'project'),
                name: manifest?.project.name ?? repository.name,
                description:
                  manifest?.project.description ??
                  (genericRepositoryPreview
                    ? `Read-only preview of ${repository.name}. No committed .tree-complete/project.json was found; displayed decisions are generic simulation examples.`
                    : `Design-decision workspace for ${repository.name}.`),
                repository: `git:${manifest?.project.id ?? safeSlug(repository.name, 'project')}`,
                defaultBranch: repository.branch,
              },
              rootBranch: repository.branch,
              rootCommit: repository.commit,
              rootName: genericRepositoryPreview ? 'Committed HEAD · generic preview' : 'Committed design',
              rootSummary: genericRepositoryPreview
                ? `Generic illustrative decisions at committed HEAD ${shortCommit(repository.commit)}; no .tree-complete/project.json was found and preview does not mutate project files or Git state.`
                : `Manifest-backed baseline at committed HEAD ${shortCommit(repository.commit)}.`,
              decisions: manifest ? manifestToDesignDecisions(manifest) : undefined,
            }
          : {}),
      }))
  const store =
    options.store ??
    (await WorkspaceStore.open({
      dataDir: config.dataDir,
      stateKey: workspaceStateKey(
        config.agentMode,
        repository
          ? config.agentMode === 'preview'
            ? `${repository.root}\0${repository.branch}\0${repository.commit}\0${manifest?.project.id ?? 'generic'}\0preview-v1`
            : `${repository.root}\0${manifest?.project.id ?? 'unconfigured'}\0manifest-v1`
          : undefined,
      ),
      seed,
      runner: descriptor,
    }))
  const runner = options.runner ?? createRunner(config)

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16 * 1024,
    trustProxy: false,
  })
  const orchestrator = new ForkOrchestrator({
    store,
    runner,
    diagnostic: (message, error) => app.log.error({ err: error }, message),
  })
  app.decorate('workspaceStore', store)
  app.decorate('forkOrchestrator', orchestrator)
  app.decorate('treeCompleteConfig', config)

  app.addHook('onRequest', async (request) => {
    if (!isLoopbackAuthority(request.headers.host)) {
      throw new ApiProblem(403, 'invalid_host', 'Tree Complete accepts loopback requests only.')
    }
    const origin = request.headers.origin
    if (isMutation(request.method) && origin && !isLoopbackOrigin(origin)) {
      throw new ApiProblem(403, 'invalid_origin', 'The request origin is not allowed.')
    }
  })

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    )
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
  })

  app.get('/api/health', async () => ({
    status: descriptor.available ? ('ready' as const) : ('degraded' as const),
    runner: { mode: descriptor.mode, available: descriptor.available },
  }))
  app.get('/api/workspace', async () => publicWorkspace(await store.snapshot(), config))
  app.post('/api/forks', async (request, reply) => {
    const forkRequest = parseForkRequest(request.body)
    const response = await orchestrator.createFork(forkRequest)
    return await reply.code(202).send({
      ...response,
      workspace: publicWorkspace(response.workspace, config),
    })
  })

  if ((options.serveClient ?? process.env.NODE_ENV === 'production') && (await clientExists())) {
    const clientRoot = resolve(process.cwd(), 'dist/client')
    await app.register(staticPlugin, { root: clientRoot, prefix: '/' })
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return await reply.sendFile('index.html')
      }
      return await reply.code(404).send(apiError('not_found', 'Route not found.'))
    })
  } else {
    app.setNotFoundHandler(async (_request, reply) =>
      await reply.code(404).send(apiError('not_found', 'Route not found.')),
    )
  }

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiProblem) {
      return await reply.code(error.statusCode).send(apiError(error.code, error.detail))
    }
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const statusCode = normalizedClientStatus(normalizedError)
    if (statusCode !== undefined) {
      return await reply
        .code(statusCode)
        .send(
          apiError(
            statusCode === 415
              ? 'unsupported_media_type'
              : statusCode === 413
                ? 'payload_too_large'
                : 'invalid_request',
            normalizedError.message,
          ),
        )
    }
    request.log.error({ err: normalizedError }, 'Unhandled request error')
    return await reply
      .code(500)
      .send(apiError('internal_error', 'The server could not complete the request.'))
  })

  return app
}

function shortCommit(commit: string): string {
  return commit.slice(0, 12)
}

function createRunner(config: ServerConfig): AgentRunner | undefined {
  if (config.agentMode === 'preview') return new PreviewRunner(config.previewPhaseDelayMs)
  if (!config.targetRepo) return undefined
  return new CodexRunner({ repository: config.targetRepo, dataDir: config.dataDir })
}

function parseForkRequest(body: unknown): CreateForkRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiProblem(400, 'invalid_request', 'Expected a JSON object.')
  }
  const record = body as Record<string, unknown>
  const allowed = new Set(['baseVersionId', 'decisionId', 'alternativeId'])
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ApiProblem(400, 'invalid_request', 'The request contains an unsupported field.')
  }
  for (const field of allowed) {
    const value = record[field]
    if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
      throw new ApiProblem(
        400,
        'invalid_request',
        `${field} must be a non-empty string no longer than 200 characters.`,
      )
    }
  }
  return {
    baseVersionId: record.baseVersionId as string,
    decisionId: record.decisionId as string,
    alternativeId: record.alternativeId as string,
  }
}

function normalizedClientStatus(error: Error & { statusCode?: number; code?: string }): 400 | 413 | 415 | undefined {
  if (error.statusCode === 413) return 413
  if (error.statusCode === 415 || error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return 415
  if (error.statusCode === 400 || error instanceof SyntaxError) return 400
  return undefined
}

function apiError(error: string, detail?: string): ApiError {
  return detail ? { error, detail } : { error }
}

async function clientExists(): Promise<boolean> {
  try {
    await access(resolve(process.cwd(), 'dist/client/index.html'))
    return true
  } catch {
    return false
  }
}

function publicWorkspace(workspace: Workspace, config: ServerConfig): Workspace {
  const copy = structuredClone(workspace)
  if (copy.project.repository.startsWith('/')) {
    copy.project.repository = `git:${basename(copy.project.repository)}`
  }
  const replacements = [config.targetRepo, config.dataDir].filter(
    (value): value is string => Boolean(value),
  )
  for (const run of copy.runs) {
    run.worktreePath = undefined
    if (run.error) run.error = redact(run.error, replacements)
    for (const entry of run.logs) entry.message = redact(entry.message, replacements)
  }
  return copy
}

function redact(value: string, replacements: readonly string[]): string {
  return replacements.reduce(
    (result, path) => result.replaceAll(path, '[local path]'),
    value,
  )
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackName(url.hostname)
  } catch {
    return false
  }
}

function isLoopbackAuthority(value: string | undefined): boolean {
  if (!value) return false
  try {
    return isLoopbackName(new URL(`http://${value}`).hostname)
  } catch {
    return false
  }
}

function isLoopbackName(value: string): boolean {
  const name = value.toLowerCase().replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}
