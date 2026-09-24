import { LayoutDashboard } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'

export function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Your job search at a glance." />
      <EmptyState
        icon={LayoutDashboard}
        title="Nothing to show yet"
        description="KPIs, items needing attention, and recent activity will appear here once you add applications."
      />
    </>
  )
}
