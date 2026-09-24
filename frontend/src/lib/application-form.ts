/**
 * The application form: zod validation that mirrors the API schema (backend/app/schemas.py),
 * plus conversions between API objects and form values. Form values are the strings inputs
 * hold; empty strings mean "not set".
 */
import { z } from 'zod'

import type { Application, ApplicationCreate, ApplicationUpdate } from '@/api/applications'
import { EMPLOYMENT_TYPE_LABELS, SOURCE_LABELS, WORK_MODE_LABELS } from '@/lib/enums'
import { STATUSES } from '@/lib/status'

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== ''
  } catch {
    return false
  }
}

const keysOf = <K extends string>(labels: Record<K, string>) => Object.keys(labels) as [K, ...K[]]

const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters`)
const optionalEnum = <K extends string>(labels: Record<K, string>) =>
  z.union([z.enum(keysOf(labels)), z.literal('')])
const wholeNumber = z
  .string()
  .trim()
  .regex(/^\d*$/, 'Enter a whole number')
  .refine((v) => v === '' || Number(v) <= 100_000_000, 'Too large')

export const applicationFormSchema = z
  .object({
    company: z.string().trim().min(1, 'Company is required').max(200, 'At most 200 characters'),
    job_title: z.string().trim().min(1, 'Job title is required').max(200, 'At most 200 characters'),
    job_url: optionalText(2048).refine(
      (v) => v === '' || isHttpUrl(v),
      'Must be an http:// or https:// URL',
    ),
    status: z.enum(STATUSES as [(typeof STATUSES)[number], ...typeof STATUSES]),
    date_applied: z.string(),
    location: optionalText(200),
    work_mode: optionalEnum(WORK_MODE_LABELS),
    employment_type: optionalEnum(EMPLOYMENT_TYPE_LABELS),
    source: optionalEnum(SOURCE_LABELS),
    salary_min: wholeNumber,
    salary_max: wholeNumber,
    salary_currency: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{3})?$/, 'Use a 3-letter code like USD'),
    contact_name: optionalText(200),
    contact_email: optionalText(320).refine(
      (v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
      'Enter an email address',
    ),
    auto_close_exempt: z.boolean(),
    notes: optionalText(200_000),
    job_description: optionalText(200_000),
  })
  .superRefine((values, ctx) => {
    if (values.status !== 'saved' && values.date_applied === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['date_applied'],
        message: 'Date applied is required unless the job is only saved',
      })
    }
    const min = values.salary_min === '' ? null : Number(values.salary_min)
    const max = values.salary_max === '' ? null : Number(values.salary_max)
    if (min !== null && max !== null && min > max) {
      ctx.addIssue({ code: 'custom', path: ['salary_max'], message: 'Max is below min' })
    }
  })

export type ApplicationFormValues = z.infer<typeof applicationFormSchema>

export function emptyApplicationForm(today: string): ApplicationFormValues {
  return {
    company: '',
    job_title: '',
    job_url: '',
    status: 'applied',
    date_applied: today,
    location: '',
    work_mode: '',
    employment_type: '',
    source: '',
    salary_min: '',
    salary_max: '',
    salary_currency: 'USD',
    contact_name: '',
    contact_email: '',
    auto_close_exempt: false,
    notes: '',
    job_description: '',
  }
}

export function formFromApplication(app: Application): ApplicationFormValues {
  const str = (v: string | number | null) => (v === null ? '' : String(v))
  return {
    company: app.company,
    job_title: app.job_title,
    job_url: str(app.job_url),
    status: app.status,
    date_applied: str(app.date_applied),
    location: str(app.location),
    work_mode: app.work_mode ?? '',
    employment_type: app.employment_type ?? '',
    source: app.source ?? '',
    salary_min: str(app.salary_min),
    salary_max: str(app.salary_max),
    salary_currency: str(app.salary_currency),
    contact_name: str(app.contact_name),
    contact_email: str(app.contact_email),
    auto_close_exempt: app.auto_close_exempt,
    notes: str(app.notes),
    job_description: str(app.job_description),
  }
}

const orNull = <T extends string>(v: T | '') => (v === '' ? null : v)
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

/** Every field except status, which changes through the status endpoint so it can carry a note. */
export function toUpdateBody(values: ApplicationFormValues): ApplicationUpdate {
  return editableFields(values)
}

export function toCreateBody(values: ApplicationFormValues): ApplicationCreate {
  return { ...editableFields(values), status: values.status }
}

function editableFields(values: ApplicationFormValues) {
  return {
    company: values.company.trim(),
    job_title: values.job_title.trim(),
    job_url: orNull(values.job_url.trim()),
    date_applied: orNull(values.date_applied),
    location: orNull(values.location.trim()),
    work_mode: orNull(values.work_mode),
    employment_type: orNull(values.employment_type),
    source: orNull(values.source),
    salary_min: numOrNull(values.salary_min),
    salary_max: numOrNull(values.salary_max),
    salary_currency: orNull(values.salary_currency.trim().toUpperCase()),
    contact_name: orNull(values.contact_name.trim()),
    contact_email: orNull(values.contact_email.trim()),
    auto_close_exempt: values.auto_close_exempt,
    notes: orNull(values.notes.trim()),
    job_description: orNull(values.job_description.trim()),
  }
}
