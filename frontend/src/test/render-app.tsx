/**
 * Renders the real app shell and routes at a URL, against a fake API. Each handler answers
 * one `METHOD /path` and receives the parsed request, so tests can assert on what was sent.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { render } from '@testing-library/react'

import type { ApplicationDetail } from '@/api/applications'
import type { Document } from '@/api/documents'
import { ThemeProvider } from '@/components/theme-provider'
import { routeTree } from '@/router'

export interface FakeRequest {
  url: URL
  /** Parsed JSON, or `FormData` for multipart requests. */
  body: unknown
  headers: Headers
}
type Handler = (req: FakeRequest) => Response | Promise<Response>

export interface FakeApi {
  calls: { method: string; path: string; req: FakeRequest }[]
}

export function renderApp(url: string, handlers: Record<string, Handler>) {
  const api: FakeApi = { calls: [] }
  const all: Record<string, Handler> = {
    'GET /api/health': () =>
      Response.json({ status: 'ok', version: '0.0.0-test', build_sha: 'test', db: 'ok' }),
    ...handlers,
  }
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const reqUrl = new URL(request.url)
    // Multipart bodies arrive as FormData via the TestRequest in src/test-setup.ts.
    const form = (request as Request & { formDataBody?: FormData }).formDataBody
    const text = form ? '' : await request.text()
    const body = form ?? (text ? JSON.parse(text) : undefined)
    const req = { url: reqUrl, body, headers: request.headers }
    // Match exact paths first, then patterns with a numeric id segment.
    const key = `${request.method} ${reqUrl.pathname}`
    const handler =
      all[key] ?? all[key.replace(/\/\d+(?=\/|$)/, '/:id')] ?? (() => notFound(reqUrl.pathname))
    api.calls.push({ method: request.method, path: reqUrl.pathname, req })
    return handler(req)
  }) as typeof fetch

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return { api, router }
}

function notFound(path: string) {
  return Response.json(
    { type: 'about:blank', title: 'Not Found', status: 404, detail: `No fake for ${path}` },
    { status: 404, headers: { 'content-type': 'application/problem+json' } },
  )
}

let nextId = 1

export function makeApplication(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  const id = overrides.id ?? nextId++
  return {
    id,
    company: 'Acme',
    job_title: 'Backend Engineer',
    job_url: null,
    location: null,
    work_mode: null,
    employment_type: null,
    salary_min: null,
    salary_max: null,
    salary_currency: 'USD',
    source: null,
    contact_name: null,
    contact_email: null,
    date_applied: '2026-03-10',
    status: 'applied',
    status_changed_at: '2026-03-10T15:00:00Z',
    interview_rounds: 0,
    auto_close_exempt: false,
    notes: null,
    job_description: null,
    archived: false,
    created_at: '2026-03-10T15:00:00Z',
    updated_at: '2026-03-10T15:00:00Z',
    documents: [],
    history: [
      {
        id: id * 100,
        from_status: null,
        to_status: 'applied',
        changed_at: '2026-03-10T15:00:00Z',
        source: 'user',
        note: null,
      },
    ],
    ...overrides,
  }
}

export function makeDocument(overrides: Partial<Document> = {}): Document {
  const id = overrides.id ?? nextId++
  return {
    id,
    kind: 'resume',
    display_name: 'Resume – Backend',
    original_filename: 'resume.pdf',
    mime_type: 'application/pdf',
    size_bytes: 48_000,
    sha256: 'a'.repeat(64),
    uploaded_at: '2026-03-01T12:00:00Z',
    application_count: 0,
    ...overrides,
  }
}

export function page(items: ApplicationDetail[], total = items.length) {
  return Response.json({
    items: items.map(({ history: _history, ...rest }) => rest),
    total,
    page: 1,
    page_size: 50,
  })
}
