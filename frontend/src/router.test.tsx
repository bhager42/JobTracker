import { screen } from '@testing-library/react'

import { renderApp } from '@/test/render-app'

export const emptyDashboard = {
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
}

test('renders the app shell with navigation and API version', async () => {
  renderApp('/', { 'GET /api/dashboard': () => Response.json(emptyDashboard) })
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  for (const label of ['Applications', 'Documents', 'Metrics', 'Settings']) {
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
  }
  expect(await screen.findByText('v0.0.0-test')).toBeInTheDocument()
  expect(await screen.findByText('Nothing to show yet')).toBeInTheDocument()
})
