/**
 * The Metrics page's URL search params, and date presets resolved to concrete ranges.
 * Weeks start Monday (ISO), matching the server's buckets.
 */
import { format, startOfISOWeek, startOfMonth, startOfYear, subMonths, subWeeks } from 'date-fns'
import { z } from 'zod'

import type { Granularity, MetricsQuery } from '@/api/metrics'
import { SOURCE_LABELS, WORK_MODE_LABELS } from '@/lib/enums'
import { STATUSES } from '@/lib/status'

export const PRESETS = {
  '12w': 'Last 12 weeks',
  '12m': 'Last 12 months',
  ytd: 'Year to date',
  all: 'All time',
  custom: 'Custom range',
} as const
export type Preset = keyof typeof PRESETS

export const GRANULARITIES = { week: 'Weekly', month: 'Monthly', year: 'Yearly' } as const

/** Each preset's natural granularity, used when the URL doesn't say. */
const DEFAULT_GRANULARITY: Record<Preset, Granularity> = {
  '12w': 'week',
  '12m': 'month',
  ytd: 'month',
  all: 'month',
  custom: 'month',
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (Array.isArray(v) ? v : [v]), z.array(item))

const schema = z.object({
  preset: z
    .enum(Object.keys(PRESETS) as [Preset, ...Preset[]])
    .optional()
    .catch(undefined),
  granularity: z.enum(['week', 'month', 'year']).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  status: listOf(z.enum(STATUSES as [string, ...string[]]))
    .optional()
    .catch(undefined),
  source: listOf(z.enum(Object.keys(SOURCE_LABELS) as [string, ...string[]]))
    .optional()
    .catch(undefined),
  work_mode: listOf(z.enum(Object.keys(WORK_MODE_LABELS) as [string, ...string[]]))
    .optional()
    .catch(undefined),
})

export interface MetricsSearch {
  preset?: Preset
  granularity?: Granularity
  from?: string
  to?: string
  status?: NonNullable<MetricsQuery['status']>
  source?: NonNullable<MetricsQuery['source']>
  work_mode?: NonNullable<MetricsQuery['work_mode']>
}

export function validateMetricsSearch(raw: Record<string, unknown>): MetricsSearch {
  const parsed = schema.parse(raw)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) out[k] = v
  }
  return out as MetricsSearch
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/** The date range a preset covers, as of `today`. */
export function presetRange(preset: Preset, today: Date): { from?: string; to?: string } {
  switch (preset) {
    case '12w':
      return { from: iso(startOfISOWeek(subWeeks(today, 11))), to: iso(today) }
    case '12m':
      return { from: iso(startOfMonth(subMonths(today, 11))), to: iso(today) }
    case 'ytd':
      return { from: iso(startOfYear(today)), to: iso(today) }
    case 'all':
    case 'custom':
      return {}
  }
}

export interface ResolvedMetrics {
  preset: Preset
  granularity: Granularity
  query: MetricsQuery
}

/** Turns URL params into the API query every chart shares. Default: last 12 months. */
export function resolveMetrics(search: MetricsSearch, today: Date = new Date()): ResolvedMetrics {
  const preset = search.preset ?? '12m'
  const range =
    preset === 'custom' ? { from: search.from, to: search.to } : presetRange(preset, today)
  return {
    preset,
    granularity: search.granularity ?? DEFAULT_GRANULARITY[preset],
    query: {
      from: range.from,
      to: range.to,
      status: search.status,
      source: search.source,
      work_mode: search.work_mode,
    },
  }
}
