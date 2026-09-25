import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '@/api/client'

export type Dashboard = Schemas['DashboardOut']
export type ActivityItem = Schemas['ActivityItem']

export function useDashboard() {
  return useQuery({
    // Under "applications" so any application change refreshes it too.
    queryKey: ['applications', 'dashboard'],
    queryFn: () => unwrap(api.GET('/api/dashboard')),
  })
}
