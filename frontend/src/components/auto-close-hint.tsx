import { Bot, Hourglass } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { autoCloseCountdown } from '@/lib/dates'
import { cn } from '@/lib/utils'

/** "Auto-closes in X days", shown as a warning when 7 days or fewer remain. */
export function AutoCloseHint({
  autoCloseAt,
  className,
}: {
  autoCloseAt: string | null | undefined
  className?: string
}) {
  const countdown = autoCloseCountdown(autoCloseAt)
  if (!countdown) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        countdown.soon ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
        className,
      )}
      data-soon={countdown.soon || undefined}
    >
      <Hourglass className="size-3" aria-hidden />
      {countdown.label}
    </span>
  )
}

/** Marks an application closed by the auto-close rule. */
export function AutoClosedIcon({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label="Closed automatically"
          className={cn('inline-flex text-muted-foreground', className)}
        >
          <Bot className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Closed automatically after no response</TooltipContent>
    </Tooltip>
  )
}
