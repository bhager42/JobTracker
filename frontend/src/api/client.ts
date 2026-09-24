import { useQuery } from '@tanstack/react-query'
import createClient, { type Middleware } from 'openapi-fetch'

import type { components, paths } from '@/api/schema.gen'

export type Schemas = components['schemas']
export type Problem = Schemas['Problem']

/** An API error, carrying the RFC 9457 problem body when the server sent one. */
export class ApiError extends Error {
  readonly status: number
  readonly problem: Problem | null

  constructor(status: number, problem: Problem | null, fallback: string) {
    super(problemMessage(problem) ?? fallback)
    this.status = status
    this.problem = problem
  }
}

function problemMessage(problem: Problem | null): string | null {
  if (!problem) return null
  const field = problem.errors?.[0]
  if (field) {
    const name = field.loc.filter((part) => part !== 'body' && part !== 'query').join('.')
    return name ? `${name}: ${field.msg}` : field.msg
  }
  return problem.detail ?? problem.title
}

// PLAN.md §9: every request carries this header. It forces a CORS preflight for
// cross-origin callers, which fails because the API enables no CORS.
const requestedWith: Middleware = {
  onRequest({ request }) {
    request.headers.set('X-Requested-With', 'jobtracker')
    return request
  },
}

export const api = createClient<paths>({
  baseUrl: window.location.origin,
  // Look up fetch per call (not once at import) so tests can stub it.
  fetch: (request) => globalThis.fetch(request),
})
api.use(requestedWith)

/** Unwraps an openapi-fetch result, throwing `ApiError` on any non-2xx response. */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise
  if (!response.ok) {
    const problem = isProblem(error) ? error : null
    throw new ApiError(response.status, problem, `${response.status} ${response.statusText}`)
  }
  return data as T
}

function isProblem(value: unknown): value is Problem {
  return typeof value === 'object' && value !== null && 'status' in value && 'title' in value
}

export type Health = Schemas['HealthOut']

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => unwrap(api.GET('/api/health')),
    refetchInterval: 60_000,
  })
}
