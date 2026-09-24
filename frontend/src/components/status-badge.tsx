import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STATUS_META, TONE_CLASSES, statusLabel, type Status } from '@/lib/status'

export function StatusBadge({
  status,
  interviewRounds,
  className,
}: {
  status: Status
  interviewRounds?: number
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(TONE_CLASSES[STATUS_META[status].tone], className)}
      data-status={status}
    >
      {statusLabel(status, interviewRounds)}
    </Badge>
  )
}
