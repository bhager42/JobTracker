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

export function useApplications(query: ApplicationListQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => unwrap(api.GET('/api/applications', { params: { query } })),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
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

/**
 * Store a fresh detail response, then refetch everything else derived from applications:
 * lists, the board, the dashboard, metrics, and stats all live under the `applications`
 * key. The detail just returned by the server is already current, so it's skipped.
 */
function onDetailChanged(client: QueryClient, app: ApplicationDetail) {
  client.setQueryData(keys.detail(app.id), app)
  const fresh = keys.detail(app.id)
  return client.invalidateQueries({
    queryKey: keys.all,
    predicate: (q) =>
      q.queryKey.length !== fresh.length || q.queryKey.some((k, i) => k !== fresh[i]),
  })
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
      return client.invalidateQueries({ queryKey: keys.all })
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

export function useUndoAutoClose(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/applications/{app_id}/undo-auto-close', {
          params: { path: { app_id: id } },
        }),
      ),
    onSuccess: (app) => onDetailChanged(client, app),
  })
}

export type BoardQuery = Omit<ApplicationListQuery, 'page' | 'page_size' | 'sort'>

export const boardKey = (query: BoardQuery) => ['applications', 'list', 'board', query] as const

/** Every application matching the filters, for the board (which has no paging). */
export function useBoardApplications(query: BoardQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: boardKey(query),
    queryFn: async () => {
      const all: Application[] = []
      for (let page = 1; ; page++) {
        const res = await unwrap(
          api.GET('/api/applications', {
            params: { query: { ...query, sort: '-status_changed_at', page, page_size: 200 } },
          }),
        )
        all.push(...res.items)
        if (all.length >= res.total || res.items.length === 0) return all
      }
    },
    placeholderData: keepPreviousData,
  })
}

/**
 * Moves an application to a new status with an optimistic update of the board: the card
 * jumps columns immediately and snaps back if the server refuses.
 */
export function useMoveApplication(query: BoardQuery) {
  const client = useQueryClient()
  const key = boardKey(query)
  return useMutation({
    mutationFn: ({ id, change }: { id: number; change: StatusChange }) =>
      unwrap(
        api.POST('/api/applications/{app_id}/status', {
          params: { path: { app_id: id } },
          body: change,
        }),
      ),
    onMutate: async ({ id, change }) => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<Application[]>(key)
      client.setQueryData<Application[]>(key, (apps) =>
        apps?.map((a) =>
          a.id === id
            ? {
                ...a,
                status: change.status,
                interview_rounds: change.interview_rounds ?? a.interview_rounds,
                auto_closed: false,
                auto_close_at: null, // recomputed by the server on refetch
              }
            : a,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) client.setQueryData(key, context.previous)
    },
    onSuccess: (app) => {
      client.setQueryData(keys.detail(app.id), app)
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.all }),
  })
}
