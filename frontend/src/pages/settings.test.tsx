import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { autoCloseCountdown } from '@/lib/dates'
import { makeApplication, page, renderApp } from '@/test/render-app'

const NOW = new Date('2026-03-10T15:00:00Z')

beforeEach(() => {
  // Freeze only Date, so countdowns are deterministic but user-event's timers still run.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

const settings = (overrides: object = {}) => ({
  auto_close: { enabled: true, days: 30, statuses: ['applied'], ...overrides },
  auto_close_allowed_statuses: ['applied', 'screening', 'interviewing'],
})

describe('autoCloseCountdown', () => {
  test('rounds up to whole days and warns within a week', () => {
    expect(autoCloseCountdown('2026-03-25T15:00:00Z', NOW)).toEqual({
      days: 15,
      soon: false,
      label: 'Auto-closes in 15 days',
    })
    expect(autoCloseCountdown('2026-03-17T14:00:00Z', NOW)).toMatchObject({ days: 7, soon: true })
    expect(autoCloseCountdown('2026-03-11T09:00:00Z', NOW)?.label).toBe('Auto-closes in 1 day')
    expect(autoCloseCountdown('2026-03-09T00:00:00Z', NOW)?.label).toBe(
      'Auto-closes within the hour',
    )
    expect(autoCloseCountdown(null, NOW)).toBeNull()
  })
})

describe('Settings page', () => {
  test('saves auto-close changes with a PATCH', async () => {
    const user = userEvent.setup()
    const { api } = renderApp('/settings', {
      'GET /api/settings': () => Response.json(settings()),
      'PATCH /api/settings': ({ body }) =>
        Response.json(settings((body as { auto_close: object }).auto_close)),
      'GET /api/about': () =>
        Response.json({ version: '1.2.3', build_sha: 'abc123', data_dir: '/data' }),
    })
    const days = await screen.findByLabelText('Close after (days without an update)')
    expect(days).toHaveValue(30)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.clear(days)
    await user.type(days, '21')
    await user.click(screen.getByLabelText('Recruiter Screen'))
    // Run now waits until changes are saved.
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'PATCH')?.req.body).toEqual({
        auto_close: { enabled: true, days: 21, statuses: ['applied', 'screening'] },
      }),
    )
    expect(await screen.findByText('Auto-close settings saved')).toBeInTheDocument()
    expect(screen.getByText('/data')).toBeInTheDocument()
  })

  test('rejects an out-of-range window before saving', async () => {
    const user = userEvent.setup()
    renderApp('/settings', { 'GET /api/settings': () => Response.json(settings()) })
    const days = await screen.findByLabelText('Close after (days without an update)')
    await user.clear(days)
    await user.type(days, '400')
    expect(screen.getByText('Enter a number from 1 to 365')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('Run now reports how many applications closed', async () => {
    const user = userEvent.setup()
    renderApp('/settings', {
      'GET /api/settings': () => Response.json(settings()),
      'POST /api/automation/auto-close/run': () =>
        Response.json({ enabled: true, closed: 3, application_ids: [1, 2, 3] }),
    })
    await user.click(await screen.findByRole('button', { name: 'Run now' }))
    expect(await screen.findByText('Closed 3 applications')).toBeInTheDocument()
  })

  test('Run now is unavailable while auto-close is off', async () => {
    renderApp('/settings', {
      'GET /api/settings': () => Response.json(settings({ enabled: false })),
    })
    expect(await screen.findByRole('button', { name: 'Run now' })).toBeDisabled()
    expect(screen.getByLabelText('Close after (days without an update)')).toBeDisabled()
  })
})

describe('Auto-close in the app', () => {
  test('the table shows the countdown and marks auto-closed rows', async () => {
    renderApp('/applications', {
      'GET /api/applications': () =>
        page([
          makeApplication({ company: 'Acme', auto_close_at: '2026-03-14T15:00:00Z' }),
          makeApplication({ company: 'Globex', auto_close_at: '2026-04-01T15:00:00Z' }),
          makeApplication({ company: 'Initech', status: 'not_selected', auto_closed: true }),
        ]),
    })
    const table = await screen.findByRole('table')
    const soon = within(table).getByText('Auto-closes in 4 days')
    expect(soon.closest('[data-soon]')).not.toBeNull()
    expect(within(table).getByText('Auto-closes in 22 days').closest('[data-soon]')).toBeNull()
    expect(within(table).getAllByRole('img', { name: 'Closed automatically' })).toHaveLength(1)
  })

  test('the detail page offers Undo for an auto-closed application', async () => {
    const user = userEvent.setup()
    const app = makeApplication({
      status: 'not_selected',
      auto_closed: true,
      history: [
        {
          id: 1,
          from_status: 'applied',
          to_status: 'not_selected',
          changed_at: '2026-03-10T14:00:00Z',
          source: 'automation',
          note: 'Auto-closed after 30 days with no update',
        },
      ],
    })
    const { api } = renderApp(`/applications/${app.id}`, {
      'GET /api/applications/:id': () => Response.json(app),
      'POST /api/applications/:id/undo-auto-close': () =>
        Response.json({ ...app, status: 'applied', auto_closed: false }),
    })
    expect(
      await screen.findByText('Auto-closed after 30 days with no update', { selector: 'span' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(api.calls.some((c) => c.path.endsWith('/undo-auto-close'))).toBe(true),
    )
    expect(await screen.findByText('Restored to Applied')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument(),
    )
  })
})
