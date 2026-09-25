import { format, formatDistanceStrict, parseISO } from 'date-fns'

/** Today as a plain `YYYY-MM-DD` date in the browser's time zone. */
export function todayISO(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd')
}

/**
 * Formats a plain API date (`YYYY-MM-DD`). `parseISO` reads a bare date as local midnight,
 * so the day never shifts the way `new Date('2026-03-10')` (UTC midnight) can. A full UTC
 * timestamp gives its local calendar date.
 */
export function formatDate(value: string | null | undefined): string {
  return value ? format(parseISO(value), 'MMM d, yyyy') : '—'
}

/** Formats an API UTC timestamp in local time. */
export function formatDateTime(value: string): string {
  return format(parseISO(value), 'MMM d, yyyy, h:mm a')
}

export function formatRelative(value: string, now: Date = new Date()): string {
  const then = parseISO(value)
  if (Math.abs(now.getTime() - then.getTime()) < 60_000) return 'just now'
  return formatDistanceStrict(then, now, { addSuffix: true })
}

export interface AutoCloseCountdown {
  /** Whole days left, rounded up; 0 means it closes on the next hourly run. */
  days: number
  /** Close enough (7 days or fewer) to show as a warning. */
  soon: boolean
  label: string
}

/** "Auto-closes in X days" for an application's `auto_close_at`, or null if it won't. */
export function autoCloseCountdown(
  autoCloseAt: string | null | undefined,
  now: Date = new Date(),
): AutoCloseCountdown | null {
  if (!autoCloseAt) return null
  const ms = parseISO(autoCloseAt).getTime() - now.getTime()
  const days = Math.max(0, Math.ceil(ms / 86_400_000))
  const label =
    days === 0
      ? 'Auto-closes within the hour'
      : days === 1
        ? 'Auto-closes in 1 day'
        : `Auto-closes in ${days} days`
  return { days, soon: days <= 7, label }
}
