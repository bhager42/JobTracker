import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'

import { ThemeProvider } from '@/components/theme-provider'
import { router } from '@/router'

beforeAll(() => {
  globalThis.fetch = vi.fn(async () =>
    Response.json({ status: 'ok', version: '9.9.9', build_sha: 'test', db: 'ok' }),
  ) as typeof fetch
})

test('renders the app shell with navigation and API version', async () => {
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  for (const label of ['Applications', 'Documents', 'Metrics', 'Settings']) {
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
  }
  expect(await screen.findByText('v9.9.9')).toBeInTheDocument()
})
