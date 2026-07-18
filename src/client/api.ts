import type {
  ApiError,
  CreateForkRequest,
  CreateForkResponse,
  Workspace,
} from '../shared/model'

export class RequestError extends Error {
  readonly status: number
  readonly detail?: string

  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'RequestError'
    this.status = status
    this.detail = detail
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let payload: ApiError | undefined
    try {
      payload = (await response.json()) as ApiError
    } catch {
      // An upstream proxy may return text or HTML; the status remains useful.
    }

    throw new RequestError(
      payload?.error || `Request failed (${response.status})`,
      response.status,
      payload?.detail,
    )
  }

  return (await response.json()) as T
}

export function getWorkspace(signal?: AbortSignal): Promise<Workspace> {
  return requestJson<Workspace>('/api/workspace', { signal })
}

export function createFork(
  request: CreateForkRequest,
  signal?: AbortSignal,
): Promise<CreateForkResponse> {
  return requestJson<CreateForkResponse>('/api/forks', {
    method: 'POST',
    body: JSON.stringify(request),
    signal,
  })
}

export function readableError(error: unknown): string {
  if (error instanceof RequestError) {
    return error.detail ? `${error.message}: ${error.detail}` : error.message
  }
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong while contacting the workspace.'
}
