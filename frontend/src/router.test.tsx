import { screen } from '@testing-library/react'

import { emptyDashboard, renderApp } from '@/test/render-app'

test('renders the app shell with navigation and API version', async () => {
  renderApp('/', { 'GET /api/dashboard': () => Response.json(emptyDashboard) })
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  for (const label of ['Applications', 'Documents', 'Metrics', 'Settings']) {
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
  }
  expect(await screen.findByText('v0.0.0-test')).toBeInTheDocument()
  expect(await screen.findByText('Nothing to show yet')).toBeInTheDocument()
})
