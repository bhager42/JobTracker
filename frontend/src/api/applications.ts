import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '@/api/client'
import type { operations } from '@/api/schema.gen'

export type Application = Schemas['ApplicationOut']
export type ApplicationDetail = Schemas['ApplicationDetail']
export type ApplicationCreate = Schemas['ApplicationCreate']
export type ApplicationUpdate = Schemas['ApplicationUpdate']
export type StatusChange = Schemas['StatusChange']
export type BulkAction = Schemas['BulkAction']
export type HistoryEntry = Schemas['StatusHistoryOut']
export type ApplicationListQuery = NonNullable<
  operations['list_applications_api_applications_get']['parameters']['query']
>
export type SortKey = NonNullable<ApplicationListQuery['sort']>

const keys = {
  all: ['applications'] as const,
  list: (query: ApplicationListQuery) => ['applications', 'list', query] as const,
  detail: (id: number) => ['applications', 'detail', id] as const,
}

export function useApplications(query: ApplicationListQuery) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => unwrap(api.GET('/api/applications', { params: { query } })),
    placeholderData: keepPreviousData,
  })
}

export function useApplication(id: number) {
  return useQuery({
    queryKey: keys.detail(id),
    queryFn: () =>
      unwrap(api.GET('/api/applications/{app_id}', { params: { path: { app_id: id } } })),
    enabled: Number.isInteger(id),
  })
}

/** Store a fresh detail response and refetch every list, since any field can move a row. */
function onDetailChanged(client: QueryClient, app: ApplicationDetail) {
  client.setQueryData(keys.detail(app.id), app)
  return client.invalidateQueries({ queryKey: ['applications', 'list'] })
}

export function useCreateApplication() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: ApplicationCreate) => unwrap(api.POST('/api/applications', { body })),
    onSuccess: (app) => onDetailChanged(client, app),
  })
}

export function useUpdateApplication(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: ApplicationUpdate) =>
      unwrap(api.PATCH('/api/applications/{app_id}', { params: { path: { app_id: id } }, body })),
    onSuccess: (app) => onDetailChanged(client, app),
  })
}

export function useChangeStatus(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: StatusChange) =>
      unwrap(
        api.POST('/api/applications/{app_id}/status', { params: { path: { app_id: id } }, body }),
      ),
    onSuccess: (app) => onDetailChanged(client, app),
  })
}

export function useDeleteApplication() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.DELETE('/api/applications/{app_id}', { params: { path: { app_id: id } } })),
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: keys.detail(id) })
      return client.invalidateQueries({ queryKey: ['applications', 'list'] })
    },
  })
}

export function useBulkAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: BulkAction) => unwrap(api.POST('/api/applications/bulk', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all }),
  })
}
