/**
 * Status labels, groups, and colors: the one place the frontend defines them (CLAUDE.md).
 * Keys come from the generated API types, so a new backend status fails the type check here.
 */
import type { Schemas } from '@/api/client'

export type Status = Schemas['Status']
export type StatusGroup = 'pre_application' | 'active' | 'closed'

type Tone = 'slate' | 'blue' | 'sky' | 'amber' | 'green' | 'emerald' | 'red' | 'gray'

interface StatusMeta {
  label: string
  group: StatusGroup
  tone: Tone
}

export const STATUS_META = {
  saved: { label: 'Saved / Wishlist', group: 'pre_application', tone: 'slate' },
  applied: { label: 'Applied', group: 'active', tone: 'blue' },
  screening: { label: 'Recruiter Screen', group: 'active', tone: 'sky' },
  interviewing: { label: 'Interviewing', group: 'active', tone: 'amber' },
  offer: { label: 'Offer Received', group: 'active', tone: 'green' },
  accepted: { label: 'Accepted', group: 'closed', tone: 'emerald' },
  declined: { label: 'Offer Declined', group: 'closed', tone: 'gray' },
  withdrawn: { label: 'Withdrawn', group: 'closed', tone: 'gray' },
  rejected_no_interview: { label: 'Rejected (No Interview)', group: 'closed', tone: 'red' },
  rejected_after_interview: { label: 'Rejected (After Interview)', group: 'closed', tone: 'red' },
  not_selected: { label: 'Not Selected (No Response)', group: 'closed', tone: 'red' },
  closed: { label: 'Position Closed', group: 'closed', tone: 'gray' },
} as const satisfies Record<Status, StatusMeta>

/** Statuses in pipeline order, for menus and filters. */
export const STATUSES = Object.keys(STATUS_META) as Status[]

export const STATUS_LABELS = Object.fromEntries(
  STATUSES.map((status) => [status, STATUS_META[status].label]),
) as Record<Status, string>

export const TONE_CLASSES: Record<Tone, string> = {
  slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/25',
  green: 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20',
  emerald: 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border-emerald-600/25',
  red: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20',
  gray: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20',
}

/** Solid dot colors for timelines and compact indicators. */
export const TONE_DOT: Record<Tone, string> = {
  slate: 'bg-slate-400',
  blue: 'bg-blue-500',
  sky: 'bg-sky-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  emerald: 'bg-emerald-600',
  red: 'bg-red-500',
  gray: 'bg-zinc-400',
}

export function isTerminal(status: Status): boolean {
  return STATUS_META[status].group === 'closed'
}

/** Statuses where the interview round count is worth asking for. */
export function asksForRounds(status: Status): boolean {
  return status === 'interviewing' || status === 'rejected_after_interview'
}

/** The label, with the round reached for post-interview rejections ("after round 2"). */
export function statusLabel(status: Status, interviewRounds = 0): string {
  if (status === 'rejected_after_interview' && interviewRounds > 0) {
    return `Rejected (After Round ${interviewRounds})`
  }
  return STATUS_META[status].label
}
