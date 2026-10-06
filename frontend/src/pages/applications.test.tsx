import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeApplication, page, renderApp } from '@/test/render-app'

describe('Applications page', () => {
  test('lists applications from the API', async () => {
    renderApp('/applications', {
      'GET /api/applications': () =>
        page([
          makeApplication({ company: 'Acme', status: 'interviewing' }),
          makeApplication({
            company: 'Globex',
            job_title: 'Data Engineer',
            status: 'rejected_after_interview',
            interview_rounds: 2,
          }),
        ]),
    })
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: 'Acme' })).toBeInTheDocument()
    expect(within(table).getByText('Data Engineer')).toBeInTheDocument()
    expect(within(table).getByText('Rejected (After Round 2)')).toBeInTheDocument()
    expect(screen.getByText('1–2 of 2')).toBeInTheDocument()
  })

  test('URL filters are sent to the API', async () => {
    const { api } = renderApp('/applications?status=%5B%22applied%22%5D&q=%22acme%22', {
      'GET /api/applications': () => page([makeApplication()]),
    })
    await screen.findByRole('table')
    const url = api.calls.find((c) => c.path === '/api/applications')!.req.url
    expect(url.searchParams.getAll('status')).toEqual(['applied'])
    expect(url.searchParams.get('q')).toBe('acme')
    expect(url.searchParams.get('sort')).toBe('-date_applied')
  })

  test('shows an empty state with an add button when there are no applications', async () => {
    renderApp('/applications', { 'GET /api/applications': () => page([]) })
    expect(await screen.findByText('No applications yet')).toBeInTheDocument()
  })

  test('quick add posts the form and sends the CSRF header', async () => {
    const user = userEvent.setup()
    const created = makeApplication({ company: 'Initech' })
    const { api } = renderApp('/applications', {
      'GET /api/applications': () => page([]),
      'POST /api/applications': () => Response.json(created, { status: 201 }),
    })
    await screen.findByText('No applications yet')
    await user.click(screen.getAllByRole('button', { name: 'New application' })[0]!)

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add application' }))
    expect(await within(dialog).findByText('Company is required')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Company'), 'Initech')
    await user.type(within(dialog).getByLabelText('Job title'), 'Engineer')
    await user.type(within(dialog).getByLabelText('Job posting URL'), 'https://initech.example/1')
    await user.click(within(dialog).getByRole('button', { name: 'Add application' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = api.calls.find((c) => c.method === 'POST')!
    expect(post.req.body).toMatchObject({
      company: 'Initech',
      job_title: 'Engineer',
      job_url: 'https://initech.example/1',
      status: 'applied',
    })
    expect(post.req.headers.get('X-Requested-With')).toBe('jobtracker')
    expect(await screen.findByText('Added Initech')).toBeInTheDocument()
  })

  test('bulk delete asks for confirmation, then posts the selected ids', async () => {
    const user = userEvent.setup()
    const a = makeApplication({ company: 'Acme' })
    const b = makeApplication({ company: 'Globex' })
    const { api } = renderApp('/applications', {
      'GET /api/applications': () => page([a, b]),
      'POST /api/applications/bulk': () => Response.json({ affected: 2 }),
    })
    await screen.findByRole('table')
    await user.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
    const bar = screen.getByRole('region', { name: 'Bulk actions' })
    expect(within(bar).getByText('2 applications selected')).toBeInTheDocument()

    await user.click(within(bar).getByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/api/applications/bulk')?.req.body).toEqual({
        action: 'delete',
        ids: [a.id, b.id],
      }),
    )
  })
})

describe('Application detail page', () => {
  test('shows details and the status timeline', async () => {
    const app = makeApplication({
      company: 'Acme',
      status: 'screening',
      notes: 'Talked to **Jane**',
      history: [
        {
          id: 1,
          from_status: null,
          to_status: 'applied',
          changed_at: '2026-03-10T15:00:00Z',
          source: 'user',
          note: null,
        },
        {
          id: 2,
          from_status: 'applied',
          to_status: 'screening',
          changed_at: '2026-03-12T15:00:00Z',
          source: 'user',
          note: 'Recruiter called',
        },
      ],
    })
    renderApp(`/applications/${app.id}`, { 'GET /api/applications/:id': () => Response.json(app) })

    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument()
    const timeline = screen.getByRole('list', { name: 'Status history' })
    const entries = within(timeline).getAllByRole('listitem')
    expect(entries[0]).toHaveTextContent('Recruiter called')
    expect(entries[1]).toHaveTextContent('Created as Applied')
    // Notes render as markdown.
    expect(screen.getByText('Jane').tagName).toBe('STRONG')
  })

  test('changing status posts to the status endpoint with rounds and note', async () => {
    const user = userEvent.setup()
    const app = makeApplication({ status: 'applied' })
    const { api } = renderApp(`/applications/${app.id}`, {
      'GET /api/applications/:id': () => Response.json(app),
      'POST /api/applications/:id/status': ({ body }) =>
        Response.json({ ...app, ...(body as object) }),
    })
    await user.click(await screen.findByRole('button', { name: 'Change status' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Rejected (After Interview)' }))
    const rounds = within(dialog).getByLabelText('Interview rounds reached')
    await user.clear(rounds)
    await user.type(rounds, '2')
    await user.type(within(dialog).getByLabelText('Note'), 'Went with another candidate')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'POST')?.req.body).toEqual({
        status: 'rejected_after_interview',
        interview_rounds: 2,
        note: 'Went with another candidate',
      }),
    )
  })

  test('editing a field and saving sends a PATCH', async () => {
    const user = userEvent.setup()
    const app = makeApplication({ location: null })
    const { api } = renderApp(`/applications/${app.id}`, {
      'GET /api/applications/:id': () => Response.json(app),
      'PATCH /api/applications/:id': ({ body }) => Response.json({ ...app, ...(body as object) }),
    })
    await user.type(await screen.findByLabelText('Location'), 'Chicago, IL')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'PATCH')?.req.body).toMatchObject({
        location: 'Chicago, IL',
        company: 'Acme',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument(),
    )
  })

  test('a missing application shows not found', async () => {
    renderApp('/applications/999', {})
    expect(await screen.findByText('Application not found')).toBeInTheDocument()
  })
})

test('the detail page saves a salary expectation', async () => {
  const user = userEvent.setup()
  const app = makeApplication({ salary_min: 120000, salary_max: 150000 })
  const { api } = renderApp(`/applications/${app.id}`, {
    'GET /api/applications/:id': () => Response.json(app),
    'PATCH /api/applications/:id': ({ body }) => Response.json({ ...app, ...(body as object) }),
  })
  expect(await screen.findByLabelText('Salary min')).toHaveValue('120,000')
  const expectation = screen.getByLabelText('Salary expectation')
  await user.type(expectation, '145000')
  expect(expectation).toHaveValue('145,000')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(api.calls.find((c) => c.method === 'PATCH')?.req.body).toMatchObject({
      salary_expectation: 145000,
      salary_min: 120000,
    }),
  )
})
