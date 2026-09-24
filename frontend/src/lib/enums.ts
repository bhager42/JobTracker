/** Display labels for the non-status enums. Statuses live in `status.ts`. */
import type { Schemas } from '@/api/client'

export type WorkMode = Schemas['WorkMode']
export type EmploymentType = Schemas['EmploymentType']
export type Source = Schemas['Source']

export const WORK_MODE_LABELS = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
} as const satisfies Record<WorkMode, string>

export const EMPLOYMENT_TYPE_LABELS = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
} as const satisfies Record<EmploymentType, string>

export const SOURCE_LABELS = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  referral: 'Referral',
  company_site: 'Company site',
  recruiter: 'Recruiter',
  other: 'Other',
} as const satisfies Record<Source, string>

export function entries<K extends string>(labels: Record<K, string>): [K, string][] {
  return Object.entries(labels) as [K, string][]
}

export type DocumentKind = Schemas['DocumentKind']

export const DOCUMENT_KIND_LABELS = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
  other: 'Other',
} as const satisfies Record<DocumentKind, string>
