import { BarChart3 } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'

export function MetricsPage() {
  return (
    <>
      <PageHeader title="Metrics" description="Weekly, monthly, and yearly trends." />
      <EmptyState
        icon={BarChart3}
        title="No data yet"
        description="Charts for application volume, status breakdown, and your pipeline funnel will appear here."
      />
    </>
  )
}
