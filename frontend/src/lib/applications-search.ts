/**
 * The Applications page's URL search params: filters, sort, and paging live in the URL so
 * views can be bookmarked and survive reloads. Invalid values are dropped, never thrown.
 */
import { z } from 'zod'

import type { ApplicationListQuery, SortKey } from '@/api/applications'
import { SOURCE_LABELS, WORK_MODE_LABELS } from '@/lib/enums'
import { STATUSES } from '@/lib/status'

const SORT_FIELDS = [
  'company',
  'job_title',
  'date_applied',
  'status',
  'status_changed_at',
  'created_at',
  'updated_at',
] as const
export type SortField = (typeof SORT_FIELDS)[number]
export const DEFAULT_SORT: SortKey = '-date_applied'
export const PAGE_SIZES = [25, 50, 100] as const

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// A single value may arrive as a bare string; accept it as a one-item list.
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (Array.isArray(v) ? v : [v]), z.array(item))

const searchSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
  status: listOf(z.enum(STATUSES as [string, ...string[]]))
    .optional()
    .catch(undefined),
  source: listOf(z.enum(Object.keys(SOURCE_LABELS) as [string, ...string[]]))
    .optional()
    .catch(undefined),
  work_mode: listOf(z.enum(Object.keys(WORK_MODE_LABELS) as [string, ...string[]]))
    .optional()
    .catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  archived: z.enum(['exclude', 'include', 'only']).optional().catch(undefined),
  sort: z
    .string()
    .refine((v) => SORT_FIELDS.includes(v.replace(/^-/, '') as SortField))
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  page_size: z.coerce
    .number()
    .refine((v) => (PAGE_SIZES as readonly number[]).includes(v))
    .optional()
    .catch(undefined),
})

export interface ApplicationsSearch {
  q?: string
  status?: NonNullable<ApplicationListQuery['status']>
  source?: NonNullable<ApplicationListQuery['source']>
  work_mode?: NonNullable<ApplicationListQuery['work_mode']>
  from?: string
  to?: string
  archived?: NonNullable<ApplicationListQuery['archived']>
  sort?: SortKey
  page?: number
  page_size?: number
}

export function validateApplicationsSearch(raw: Record<string, unknown>): ApplicationsSearch {
  const parsed = searchSchema.parse(raw)
  // Drop empties so the URL stays clean.
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue
    }
    out[key] = value
  }
  return out as ApplicationsSearch
}

export function toListQuery(search: ApplicationsSearch): ApplicationListQuery {
  return {
    ...search,
    q: search.q?.trim() || undefined,
    sort: search.sort ?? DEFAULT_SORT,
    page: search.page ?? 1,
    page_size: search.page_size ?? 50,
  }
}

export function hasActiveFilters(search: ApplicationsSearch): boolean {
  return Boolean(
    search.q ||
    search.status?.length ||
    search.source?.length ||
    search.work_mode?.length ||
    search.from ||
    search.to ||
    (search.archived && search.archived !== 'exclude'),
  )
}

const TEXT_FIELDS: readonly SortField[] = ['company', 'job_title', 'status']

/**
 * The sort after clicking a column header: the same column flips direction; a new column
 * starts A→Z for text and newest-first for dates.
 */
export function nextSort(current: SortKey, field: SortField): SortKey {
  if (current === field) return `-${field}`
  if (current === `-${field}`) return field
  return TEXT_FIELDS.includes(field) ? field : `-${field}`
}
