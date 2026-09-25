import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '@/api/client'

export type AppSettings = Schemas['SettingsOut']
export type AutoCloseSettings = Schemas['AutoCloseSettings']
export type AutoCloseSettingsUpdate = Schemas['AutoCloseSettingsUpdate']

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap(api.GET('/api/settings')),
  })
}

export function useUpdateAutoClose() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (auto_close: AutoCloseSettingsUpdate) =>
      unwrap(api.PATCH('/api/settings', { body: { auto_close } })),
    onSuccess: (settings) => {
      client.setQueryData(['settings'], settings)
      // "Auto-closes in X days" on every application depends on these settings.
      return client.invalidateQueries({ queryKey: ['applications'] })
    },
  })
}

export function useRunAutoClose() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/automation/auto-close/run')),
    onSuccess: () => client.invalidateQueries({ queryKey: ['applications'] }),
  })
}

export function useAbout() {
  return useQuery({
    queryKey: ['about'],
    queryFn: () => unwrap(api.GET('/api/about')),
    staleTime: Infinity,
  })
}
