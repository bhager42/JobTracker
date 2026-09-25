import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderApp } from '@/test/render-app'

const settings = {
  auto_close: { enabled: true, days: 30, statuses: ['applied'] },
  auto_close_allowed_statuses: ['applied', 'screening', 'interviewing'],
}
const stats = {
  applications: 12,
  archived: 2,
  documents: 3,
  history_entries: 40,
  database_bytes: 204800,
  uploads_bytes: 3 * 1024 * 1024,
}
const preview = {
  headers: ['Employer', 'Role', 'When'],
  sample_rows: [['Acme', 'Backend Engineer', '2026-03-01']],
  row_count: 3,
  suggested_mapping: { company: 'Employer', job_title: 'Role' },
  fields: ['company', 'job_title', 'date_applied', 'status'],
  required: ['company', 'job_title'],
}

function handlers(extra: Record<string, (req: { body: unknown }) => Response> = {}) {
  return {
    'GET /api/settings': () => Response.json(settings),
    'GET /api/stats': () => Response.json(stats),
    ...extra,
  }
}

test('shows stats and a backup download link', async () => {
  renderApp('/settings', handlers())
  expect(await screen.findByText('3.0 MB')).toBeInTheDocument()
  expect(screen.getByText('200 KB')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Download backup (.zip)' })).toHaveAttribute(
    'href',
    '/api/export',
  )
})

test('restoring a backup uploads it and summarises what came back', async () => {
  const user = userEvent.setup()
  const { api } = renderApp(
    '/settings',
    handlers({
      'POST /api/import': () =>
        Response.json({
          restored: true,
          applications: 12,
          documents: 3,
          documents_reused: 0,
          documents_missing: 1,
        }),
    }),
  )
  await screen.findByText('3.0 MB')
  await user.upload(
    screen.getByLabelText('Backup file'),
    new File(['PK'], 'jobtracker-export.zip', { type: 'application/zip' }),
  )
  const summary = await screen.findByText(/Backup restored/)
  expect(summary).toHaveTextContent('Backup restored: 12 applications, 3 documents.')
  expect(screen.getByText(/1 document had no file in the backup/)).toBeInTheDocument()
  const form = api.calls.find((c) => c.path === '/api/import')!.req.body as FormData
  expect((form.get('file') as File).name).toBe('jobtracker-export.zip')
})

test('CSV import: preview, map, check, then import', async () => {
  const user = userEvent.setup()
  const { api } = renderApp(
    '/settings',
    handlers({
      'POST /api/import/csv/preview': () => Response.json(preview),
      'POST /api/import/csv': ({ body }) => {
        const dryRun = (body as FormData).get('dry_run') === 'true'
        return Response.json({
          total: 3,
          valid: 2,
          created: dryRun ? 0 : 2,
          errors: [{ row: 4, message: 'company: Field required' }],
        })
      },
    }),
  )
  await user.click(await screen.findByRole('button', { name: 'Import from CSV' }))
  const dialog = await screen.findByRole('dialog', { name: 'Import from CSV' })
  await user.upload(within(dialog).getByLabelText('CSV file'), new File(['x'], 'jobs.csv'))

  // Suggested columns are pre-selected; the sample value shows for each.
  expect(await within(dialog).findByText('jobs.csv · 3 rows')).toBeInTheDocument()
  expect(within(dialog).getByRole('combobox', { name: 'Column for Company' })).toHaveTextContent(
    'Employer',
  )
  expect(within(dialog).getByText('Backend Engineer')).toBeInTheDocument()

  // Map one more column, then check.
  await user.click(within(dialog).getByRole('combobox', { name: 'Column for Date applied' }))
  await user.click(await screen.findByRole('option', { name: 'When' }))
  expect(within(dialog).getByRole('button', { name: 'Import' })).toBeDisabled()
  await user.click(within(dialog).getByRole('button', { name: 'Check' }))
  expect(await within(dialog).findByText('2 of 3 rows are ready to import.')).toBeInTheDocument()
  expect(within(dialog).getByText('Line 4: company: Field required')).toBeInTheDocument()

  await user.click(within(dialog).getByRole('button', { name: 'Import 2 rows' }))
  expect(
    await screen.findByText('Imported 2 applications; skipped 1 with problems'),
  ).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  const [check, run] = api.calls.filter((c) => c.path === '/api/import/csv')
  const sent = (call: typeof check) => call!.req.body as FormData
  expect(JSON.parse(sent(check).get('mapping') as string)).toEqual({
    company: 'Employer',
    job_title: 'Role',
    date_applied: 'When',
  })
  expect(sent(check).get('dry_run')).toBe('true')
  expect(sent(run).get('dry_run')).toBe('false')
})

test('CSV import needs the required columns mapped', async () => {
  const user = userEvent.setup()
  renderApp(
    '/settings',
    handlers({
      'POST /api/import/csv/preview': () =>
        Response.json({ ...preview, suggested_mapping: { company: 'Employer' } }),
    }),
  )
  await user.click(await screen.findByRole('button', { name: 'Import from CSV' }))
  const dialog = await screen.findByRole('dialog')
  await user.upload(within(dialog).getByLabelText('CSV file'), new File(['x'], 'jobs.csv'))
  expect(await within(dialog).findByText('Choose a column for Job title.')).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Check' })).toBeDisabled()
})
