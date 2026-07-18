export class ApiProblem extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ?? code)
    this.name = 'ApiProblem'
  }
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
