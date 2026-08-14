import staticPlugin from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { ApiError, CreateForkRequest } from '../shared/model.js'
import type { ServerConfig } from './config.js'
import { ApiProblem } from './errors.js'
import type { ForkOrchestrator } from './orchestrator.js'
import { createTreeCompleteService, type CreateTreeCompleteServiceOptions } from './service.js'
import type { WorkspaceStore } from './store.js'

declare module 'fastify' {
  interface FastifyInstance {
    workspaceStore: WorkspaceStore
    forkOrchestrator: ForkOrchestrator
    treeCompleteConfig: ServerConfig
  }
}

export interface CreateAppOptions extends CreateTreeCompleteServiceOptions {
  logger?: boolean
  serveClient?: boolean
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16 * 1024,
    trustProxy: false,
  })
  const service = await createTreeCompleteService({
    config: options.config,
    store: options.store,
    runner: options.runner,
    seed: options.seed,
    diagnostic: (message, error) => app.log.error({ err: error }, message),
  })
  app.decorate('workspaceStore', service.workspaceStore)
  app.decorate('forkOrchestrator', service.forkOrchestrator)
  app.decorate('treeCompleteConfig', service.config)
  app.addHook('onClose', async () => await service.close())

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

  app.get('/api/health', async () => service.runnerStatus)
  app.get('/api/workspace', async () => await service.workspace())
  app.post('/api/forks', async (request, reply) => {
    const response = await service.createFork(parseForkRequest(request.body))
    return await reply.code(202).send(response)
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
    app.setNotFoundHandler(
      async (_request, reply) =>
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

function normalizedClientStatus(
  error: Error & { statusCode?: number; code?: string },
): 400 | 413 | 415 | undefined {
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
