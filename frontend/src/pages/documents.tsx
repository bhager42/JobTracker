import { FileText } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'

export function DocumentsPage() {
  return (
    <>
      <PageHeader
        title="Documents"
        description="Resumes and cover letters, reusable across applications."
      />
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Upload a resume or cover letter once and attach it to as many applications as you like."
      />
    </>
  )
}
