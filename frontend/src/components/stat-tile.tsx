import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** A headline number: label, value, optional hint. Wrap in a link to make it navigable. */
export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
