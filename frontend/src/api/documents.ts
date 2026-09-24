import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { ApiError, api, unwrap, type Schemas } from '@/api/client'
import type { DocumentKind } from '@/lib/enums'

export type Document = Schemas['DocumentOut']
export type DocumentUploaded = Schemas['DocumentUploaded']
export type DocumentUpdate = Schemas['DocumentUpdate']
export type LinkedApplication = Schemas['LinkedApplication']

const keys = {
  list: (filter: DocumentFilter) => ['documents', 'list', filter] as const,
}

export interface DocumentFilter {
  kind?: DocumentKind
  q?: string
}

export function useDocuments(filter: DocumentFilter = {}) {
  return useQuery({
    queryKey: keys.list(filter),
    queryFn: () => unwrap(api.GET('/api/documents', { params: { query: filter } })),
  })
}

/** Documents and applications both show link counts, so any change refreshes both. */
function invalidateAll(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['documents'] }),
    client.invalidateQueries({ queryKey: ['applications'] }),
  ])
}

export interface UploadInput {
  file: File
  kind: DocumentKind
  displayName?: string
}

export function useUploadDocument() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ file, kind, displayName }: UploadInput) =>
      unwrap(
        api.POST('/api/documents', {
          // The generated type says `file: string` (OpenAPI's "binary"); the serializer below
          // sends the real File as multipart/form-data.
          body: { file: file as unknown as string, kind, display_name: displayName ?? null },
          bodySerializer: () => {
            const form = new FormData()
            form.append('file', file)
            form.append('kind', kind)
            if (displayName) form.append('display_name', displayName)
            return form
          },
        }),
      ),
    onSuccess: () => invalidateAll(client),
  })
}

export function useUpdateDocument() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: DocumentUpdate & { id: number }) =>
      unwrap(api.PATCH('/api/documents/{doc_id}', { params: { path: { doc_id: id } }, body })),
    onSuccess: () => invalidateAll(client),
  })
}

export function useDeleteDocument() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.DELETE('/api/documents/{doc_id}', { params: { path: { doc_id: id } } })),
    onSuccess: () => invalidateAll(client),
  })
}

export function useSetApplicationDocuments(appId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (documentIds: number[]) =>
      unwrap(
        api.PUT('/api/applications/{app_id}/documents', {
          params: { path: { app_id: appId } },
          body: { document_ids: documentIds },
        }),
      ),
    onSuccess: (app) => {
      client.setQueryData(['applications', 'detail', app.id], app)
      return invalidateAll(client)
    },
  })
}

/** The applications blocking a delete, from a 409 problem response. */
export function linkedApplications(error: unknown): LinkedApplication[] | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.problem) return null
  const problem = error.problem as Schemas['DocumentInUseProblem']
  return problem.applications ?? null
}

export function documentFileUrl(id: number, disposition: 'inline' | 'attachment') {
  return `/api/documents/${id}/file?disposition=${disposition}`
}
