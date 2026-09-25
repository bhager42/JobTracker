import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { emptyDashboard, makeApplication, renderApp } from '@/test/render-app'

/**
 * Any change to an application must refresh everything derived from applications: the
 * dashboard, metrics, and stats, not only the lists. (A bug: adding from the dashboard left
 * it showing "Nothing to show yet".)
 */
function statefulServer() {
  const apps: ReturnType<typeof makeApplication>[] = []
  return {
    apps,
    handlers: {
      'GET /api/dashboard': () =>
        Response.json({
          ...emptyDashboard,
          kpis: {
            ...emptyDashboard.kpis,
            applied_this_week: apps.length,
            applied_this_month: apps.length,
            active_pipeline: apps.length,
            total_applied: apps.length,
          },
          recent_activity: apps.map((a) => ({
            id: a.id,
            application_id: a.id,
            company: a.company,
            job_title: a.job_title,
            from_status: null,
            to_status: a.status,
            changed_at: a.created_at,
            source: 'user',
            note: null,
          })),
        }),
      'POST /api/applications': ({ body }: { body: unknown }) => {
        const app = makeApplication({ id: 1, ...(body as object), documents: [] })
        apps.push(app)
        return Response.json(app, { status: 201 })
      },
    },
  }
}

test('adding an application from the dashboard refreshes the dashboard', async () => {
  const user = userEvent.setup()
  const { handlers } = statefulServer()
  renderApp('/', handlers)
  expect(await screen.findByText('Nothing to show yet')).toBeInTheDocument()

  await user.click(screen.getAllByRole('button', { name: 'New application' })[0]!)
  const dialog = await screen.findByRole('dialog', { name: 'New application' })
  await user.type(within(dialog).getByLabelText('Company'), 'Acme')
  await user.type(within(dialog).getByLabelText('Job title'), 'Engineer')
  await user.click(within(dialog).getByRole('button', { name: 'Add application' }))

  const kpis = await screen.findByRole('region', { name: 'Key numbers' })
  await waitFor(() => expect(within(kpis).getAllByText('1').length).toBeGreaterThan(0))
  expect(screen.getByRole('list', { name: 'Recent activity' })).toHaveTextContent('Acme')
})

test('a status change elsewhere refreshes a dashboard seen earlier', async () => {
  const user = userEvent.setup()
  let app = makeApplication({ id: 7, company: 'Acme', status: 'applied' })
  let dashboardCalls = 0
  const { router } = renderApp('/', {
    'GET /api/dashboard': () => {
      dashboardCalls++
      return Response.json({
        ...emptyDashboard,
        kpis: { ...emptyDashboard.kpis, total_applied: 1, active_pipeline: 1 },
        offers_awaiting_decision: app.status === 'offer' ? [app] : [],
      })
    },
    'GET /api/applications/:id': () => Response.json(app),
    'POST /api/applications/:id/status': ({ body }) => {
      app = { ...app, ...(body as object) }
      return Response.json(app)
    },
  })
  await screen.findByRole('region', { name: 'Key numbers' })
  expect(screen.queryByRole('region', { name: 'Offers awaiting a decision' })).toBeNull()

  await router.navigate({ to: '/applications/$id', params: { id: '7' } })
  await user.click(await screen.findByRole('button', { name: 'Change status' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('combobox', { name: 'Status' }))
  await user.click(await screen.findByRole('option', { name: 'Offer Received' }))
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  // Back within the 30s cache window: the dashboard must refetch, not show the old view.
  const before = dashboardCalls
  await router.navigate({ to: '/' })
  expect(
    await screen.findByRole('region', { name: 'Offers awaiting a decision' }),
  ).toHaveTextContent('Acme')
  expect(dashboardCalls).toBeGreaterThan(before)
})
