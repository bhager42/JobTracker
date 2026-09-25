import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

export const authKey = ['auth'] as const

export function useAuthStatus() {
  return useQuery({
    queryKey: authKey,
    queryFn: () => unwrap(api.GET('/api/auth/status')),
    staleTime: Infinity,
    retry: false,
  })
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (password: string) => unwrap(api.POST('/api/auth/login', { body: { password } })),
    // Everything fetched while signed out failed; start fresh.
    onSuccess: () => client.resetQueries(),
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/auth/logout')),
    onSuccess: () => {
      // Show sign-in straight away, and drop everything fetched while signed in.
      client.setQueryData(authKey, { enabled: true, authenticated: false })
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== authKey[0] })
    },
  })
}
