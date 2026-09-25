import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeApplication, page, renderApp } from '@/test/render-app'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-10T15:00:00Z'))
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Dashboard', () => {
  test('shows the numbers the API reports', async () => {
    const offer = makeApplication({ company: 'Initech', status: 'offer' })
    const soon = makeApplication({ company: 'Umbrella', auto_close_at: '2026-03-13T15:00:00Z' })
    renderApp('/', {
      'GET /api/dashboard': () =>
        Response.json({
          kpis: {
            applied_this_week: 4,
            applied_this_month: 11,
            active_pipeline: 7,
            total_applied: 20,
            interview_rate: 0.25,
            response_rate: 0.4,
          },
          auto_closing_soon: [soon],
          offers_awaiting_decision: [offer],
          recent_activity: [
            {
              id: 1,
              application_id: offer.id,
              company: 'Initech',
              job_title: 'Engineer',
              from_status: 'interviewing',
              to_status: 'offer',
              changed_at: '2026-03-10T14:00:00Z',
              source: 'user',
              note: null,
            },
          ],
        }),
    })
    const kpis = await screen.findByRole('region', { name: 'Key numbers' })
    for (const text of ['4', '11', '7', '25%', '40%']) {
      expect(within(kpis).getByText(text)).toBeInTheDocument()
    }
    expect(within(kpis).getAllByText('of 20 applied')).toHaveLength(2)
    expect(
      within(screen.getByRole('region', { name: 'Offers awaiting a decision' })).getByText(
        'Initech',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Auto-closing within 7 days' })).getByText(
        'Auto-closes in 3 days',
      ),
    ).toBeInTheDocument()
    const feed = screen.getByRole('list', { name: 'Recent activity' })
    expect(feed).toHaveTextContent('Initech moved to Offer Received')
    expect(feed).toHaveTextContent('1 hour ago')
  })
})

describe('Command palette and shortcuts', () => {
  const handlers = {
    'GET /api/dashboard': () =>
      Response.json({
        kpis: {
          applied_this_week: 0,
          applied_this_month: 0,
          active_pipeline: 0,
          total_applied: 0,
          interview_rate: null,
          response_rate: null,
        },
        auto_closing_soon: [],
        offers_awaiting_decision: [],
        recent_activity: [],
      }),
    'GET /api/applications': ({ url }: { url: URL }) =>
      page(
        url.searchParams.get('q') === 'acme'
          ? [makeApplication({ id: 42, company: 'Acme Corp', job_title: 'Backend Engineer' })]
          : [],
      ),
    'GET /api/applications/:id': () =>
      Response.json(makeApplication({ id: 42, company: 'Acme Corp' })),
  }

  test('Ctrl+K finds an application by company and opens it', async () => {
    const user = userEvent.setup()
    const { api, router } = renderApp('/', handlers)
    await screen.findByText('Nothing to show yet')
    await user.keyboard('{Control>}k{/Control}')
    const input = await screen.findByPlaceholderText('Search applications or jump to a page…')
    await user.type(input, 'acme')
    const option = await screen.findByRole('option', { name: /Acme Corp/ })
    expect(option).toHaveTextContent('Backend Engineer')
    const call = api.calls.find((c) => c.req.url.searchParams.get('q') === 'acme')!
    expect(call.req.url.searchParams.get('archived')).toBe('include')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/applications/42'))
  })

  test('the palette switches pages and opens quick add', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/', handlers)
    await screen.findByText('Nothing to show yet')
    await user.click(screen.getByRole('button', { name: /Search…/ }))
    await user.type(await screen.findByRole('combobox'), 'sett')
    await user.click(await screen.findByRole('option', { name: /Settings/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))

    await user.keyboard('{Control>}k{/Control}')
    await user.click(await screen.findByRole('option', { name: /New application/ }))
    expect(await screen.findByRole('dialog', { name: 'New application' })).toBeInTheDocument()
  })

  test('G then A goes to Applications; N opens quick add; / focuses search', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/', handlers)
    await screen.findByText('Nothing to show yet')
    await user.keyboard('ga')
    await waitFor(() => expect(router.state.location.pathname).toBe('/applications'))

    const search = await screen.findByRole('searchbox', { name: 'Search company, title, or notes' })
    await user.keyboard('/')
    expect(search).toHaveFocus()
    // Typing in a field doesn't trigger shortcuts.
    await user.keyboard('n')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    search.blur()
    await user.keyboard('n')
    expect(await screen.findByRole('dialog', { name: 'New application' })).toBeInTheDocument()
  })
})

describe('Board view', () => {
  const apps = [
    makeApplication({ id: 1, company: 'Acme', status: 'applied' }),
    makeApplication({ id: 2, company: 'Globex', status: 'interviewing', interview_rounds: 2 }),
    makeApplication({ id: 3, company: 'Initech', status: 'rejected_no_interview' }),
  ]

  const openBoard = async () => {
    const user = userEvent.setup()
    const result = renderApp('/applications', {
      'GET /api/applications': () => page(apps),
      'POST /api/applications/:id/status': ({ url, body }) => {
        const id = Number(url.pathname.split('/')[3])
        const app = apps.find((a) => a.id === id)!
        return Response.json({ ...app, ...(body as object) })
      },
    })
    await user.click(await screen.findByRole('radio', { name: 'Board view' }))
    await screen.findByRole('region', { name: 'Application board' })
    return { user, ...result }
  }

  const column = (name: RegExp) => screen.getByRole('region', { name })

  test('groups cards by status with a collapsed Closed group', async () => {
    await openBoard()
    expect(within(column(/^Applied, 1/)).getByText('Acme')).toBeInTheDocument()
    expect(within(column(/^Interviewing, 1/)).getByText('Globex')).toBeInTheDocument()
    const closed = column(/^Closed, 1/)
    expect(within(closed).queryByText('Initech')).not.toBeInTheDocument()
    expect(closed).toHaveTextContent('Rejected (No Interview)1')
    fireEvent.click(within(closed).getByRole('button', { name: /Closed/ }))
    expect(within(closed).getByText('Initech')).toBeInTheDocument()
  })

  test('the view choice is remembered', async () => {
    await openBoard()
    expect(localStorage.getItem('jobtracker-applications-view')).toBe('"board"')
  })

  test('moving a card updates it optimistically and posts the status', async () => {
    const user = userEvent.setup()
    // Hold the server's reply so the test can see the card move before it arrives.
    let reply: () => void = () => {}
    const replied = new Promise<void>((resolve) => (reply = resolve))
    const { api } = renderApp('/applications', {
      'GET /api/applications': () => page(apps),
      'POST /api/applications/:id/status': async ({ body }) => {
        await replied
        return Response.json({ ...apps[0], ...(body as object) })
      },
    })
    await user.click(await screen.findByRole('radio', { name: 'Board view' }))
    await user.click(await screen.findByRole('button', { name: 'Move Acme' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Recruiter Screen' }))

    // The card jumps columns while the request is still in flight.
    expect(
      within(await screen.findByRole('region', { name: /^Recruiter Screen, 1/ })).getByText('Acme'),
    ).toBeInTheDocument()
    expect(api.calls.find((c) => c.method === 'POST')?.req.body).toEqual({ status: 'screening' })
    reply()
    expect(await screen.findByText('Moved Acme to Recruiter Screen')).toBeInTheDocument()
  })

  test('a failed move snaps the card back', async () => {
    const user = userEvent.setup()
    renderApp('/applications', {
      'GET /api/applications': () => page(apps),
      'POST /api/applications/:id/status': () =>
        Response.json(
          { type: 'about:blank', title: 'Server Error', status: 500, detail: 'boom' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
    })
    await user.click(await screen.findByRole('radio', { name: 'Board view' }))
    await user.click(await screen.findByRole('button', { name: 'Move Acme' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Offer Received' }))
    expect(await screen.findByText("Couldn't move Acme: boom")).toBeInTheDocument()
    expect(within(column(/^Applied, 1/)).getByText('Acme')).toBeInTheDocument()
  })

  test('moving to Rejected (After Interview) asks for the round count', async () => {
    const { user, api } = await openBoard()
    await user.click(screen.getByRole('button', { name: 'Move Globex' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rejected (After Interview)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Move Globex' })
    const rounds = within(dialog).getByLabelText('Interview rounds reached')
    expect(rounds).toHaveValue(2)
    await user.clear(rounds)
    await user.type(rounds, '3')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'POST')?.req.body).toEqual({
        status: 'rejected_after_interview',
        interview_rounds: 3,
        note: null,
      }),
    )
  })
})
