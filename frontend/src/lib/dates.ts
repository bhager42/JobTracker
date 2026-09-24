import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'

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
  return formatDistanceToNowStrict(then, { addSuffix: true })
}
