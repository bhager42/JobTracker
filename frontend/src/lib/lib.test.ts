import {
  applicationFormSchema,
  emptyApplicationForm,
  formFromApplication,
  toCreateBody,
  toUpdateBody,
  type ApplicationFormValues,
} from '@/lib/application-form'
import { nextSort, toListQuery, validateApplicationsSearch } from '@/lib/applications-search'
import { formatDate, todayISO } from '@/lib/dates'
import { formatSalary } from '@/lib/format'
import { STATUSES, STATUS_META, isTerminal, statusLabel } from '@/lib/status'
import { makeApplication } from '@/test/render-app'

describe('status', () => {
  test('matches the backend status list and order (PLAN.md §4)', () => {
    expect(STATUSES).toEqual([
      'saved',
      'applied',
      'screening',
      'interviewing',
      'offer',
      'accepted',
      'declined',
      'withdrawn',
      'rejected_no_interview',
      'rejected_after_interview',
      'not_selected',
      'closed',
    ])
  })

  test('terminal statuses are exactly the closed group', () => {
    expect(STATUSES.filter(isTerminal)).toEqual(STATUSES.slice(5))
    expect(STATUS_META.saved.group).toBe('pre_application')
  })

  test('post-interview rejection shows the round reached', () => {
    expect(statusLabel('rejected_after_interview', 2)).toBe('Rejected (After Round 2)')
    expect(statusLabel('rejected_after_interview', 0)).toBe('Rejected (After Interview)')
    expect(statusLabel('interviewing', 3)).toBe('Interviewing')
  })
})

describe('application form', () => {
  const valid = (overrides: Partial<ApplicationFormValues> = {}): ApplicationFormValues => ({
    ...emptyApplicationForm('2026-03-10'),
    company: 'Acme',
    job_title: 'Engineer',
    ...overrides,
  })
  const errorsFor = (values: ApplicationFormValues) => {
    const result = applicationFormSchema.safeParse(values)
    return result.success
      ? {}
      : Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]))
  }

  test('accepts the minimum fields', () => {
    expect(errorsFor(valid())).toEqual({})
  })

  test.each([
    [{ company: '   ' }, 'company'],
    [{ job_title: '' }, 'job_title'],
    [{ job_url: 'javascript:alert(1)' }, 'job_url'],
    [{ job_url: 'ftp://example.com' }, 'job_url'],
    [{ contact_email: 'nope' }, 'contact_email'],
    [{ salary_min: '12.5' }, 'salary_min'],
    [{ salary_min: '200', salary_max: '100' }, 'salary_max'],
    [{ salary_currency: 'DOLLARS' }, 'salary_currency'],
    [{ date_applied: '' }, 'date_applied'],
  ] as [Partial<ApplicationFormValues>, string][])('rejects %o', (overrides, field) => {
    expect(errorsFor(valid(overrides))).toHaveProperty(field)
  })

  test('date applied is optional for saved jobs', () => {
    expect(errorsFor(valid({ status: 'saved', date_applied: '' }))).toEqual({})
  })

  test('converts to an API body: blanks become null, numbers parse, currency upper-cased', () => {
    const body = toCreateBody(
      valid({ company: ' Acme ', location: '  ', salary_min: '120000', salary_currency: 'eur' }),
    )
    expect(body).toMatchObject({
      company: 'Acme',
      job_title: 'Engineer',
      status: 'applied',
      date_applied: '2026-03-10',
      location: null,
      job_url: null,
      work_mode: null,
      salary_min: 120000,
      salary_max: null,
      salary_currency: 'EUR',
    })
  })

  test('round-trips an application through the form', () => {
    const app = makeApplication({ salary_min: 100000, source: 'referral', notes: 'hi' })
    const body = toUpdateBody(formFromApplication(app))
    expect(body).toMatchObject({ salary_min: 100000, source: 'referral', notes: 'hi' })
    expect(body).not.toHaveProperty('status')
  })
})

describe('applications search params', () => {
  test('keeps valid params and drops invalid ones', () => {
    expect(
      validateApplicationsSearch({
        q: 'acme',
        status: ['applied', 'bogus'],
        source: 'linkedin',
        from: '2026-01-01',
        to: 'yesterday',
        archived: 'maybe',
        sort: '-company',
        page: '2',
        page_size: 999,
      }),
    ).toEqual({ q: 'acme', source: ['linkedin'], from: '2026-01-01', sort: '-company', page: 2 })
  })

  test('fills API defaults', () => {
    expect(toListQuery({ q: '  ' })).toEqual({
      q: undefined,
      sort: '-date_applied',
      page: 1,
      page_size: 50,
    })
  })

  test('sorting toggles direction and starts text columns A→Z, dates newest first', () => {
    expect(nextSort('-date_applied', 'date_applied')).toBe('date_applied')
    expect(nextSort('date_applied', 'date_applied')).toBe('-date_applied')
    expect(nextSort('-date_applied', 'company')).toBe('company')
    expect(nextSort('company', 'updated_at')).toBe('-updated_at')
  })
})

describe('formatting', () => {
  test('plain dates never shift by time zone', () => {
    expect(formatDate('2026-03-01')).toBe('Mar 1, 2026')
    expect(formatDate(null)).toBe('—')
    expect(todayISO(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31')
  })

  test('salary ranges', () => {
    expect(formatSalary(120000, 150000, 'USD')).toBe('$120K–$150K')
    expect(formatSalary(120000, null, 'USD')).toBe('$120K+')
    expect(formatSalary(null, 90000, 'USD')).toBe('Up to $90K')
    expect(formatSalary(null, null, 'USD')).toBe('')
  })
})

describe('salary expectation', () => {
  const values = {
    ...emptyApplicationForm('2026-03-10'),
    company: 'Acme',
    job_title: 'Engineer',
  }

  test('is sent as a number, or null when blank', () => {
    expect(toUpdateBody({ ...values, salary_expectation: '145000' }).salary_expectation).toBe(
      145000,
    )
    expect(toUpdateBody({ ...values, salary_expectation: '' }).salary_expectation).toBeNull()
    expect(
      formFromApplication(makeApplication({ salary_expectation: 150000 })).salary_expectation,
    ).toBe('150000')
  })

  test('must be a whole number', () => {
    const result = applicationFormSchema.safeParse({ ...values, salary_expectation: '12.5' })
    expect(result.success).toBe(false)
  })
})
