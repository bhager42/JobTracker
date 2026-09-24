import { ArrowRight, Bot, Upload } from 'lucide-react'

import type { HistoryEntry } from '@/api/applications'
import { formatDateTime, formatRelative } from '@/lib/dates'
import { STATUS_META, TONE_DOT } from '@/lib/status'
import { cn } from '@/lib/utils'

/** Status history, newest first. */
export function StatusTimeline({ history }: { history: HistoryEntry[] }) {
  const entries = [...history].reverse()
  return (
    <ol className="relative space-y-5 border-l pl-5" aria-label="Status history">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            aria-hidden
            className={cn(
              'absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card',
              TONE_DOT[STATUS_META[entry.to_status].tone],
            )}
          />
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            {entry.from_status === null ? (
              <>Created as {STATUS_META[entry.to_status].label}</>
            ) : (
              <>
                <span className="text-muted-foreground">
                  {STATUS_META[entry.from_status].label}
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
                {STATUS_META[entry.to_status].label}
              </>
            )}
          </p>
          {entry.note && <p className="mt-1 text-sm text-muted-foreground">{entry.note}</p>}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {entry.source === 'automation' && (
              <Bot className="size-3.5" aria-label="Changed automatically" />
            )}
            {entry.source === 'import' && <Upload className="size-3.5" aria-label="Imported" />}
            <time dateTime={entry.changed_at} title={formatDateTime(entry.changed_at)}>
              {formatRelative(entry.changed_at)}
            </time>
          </p>
        </li>
      ))}
    </ol>
  )
}
