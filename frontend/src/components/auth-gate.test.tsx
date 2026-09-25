import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { emptyDashboard, renderApp } from '@/test/render-app'

const problem = (status: number, detail: string) =>
  Response.json(
    { type: 'about:blank', title: 'Error', status, detail },
    { status, headers: { 'content-type': 'application/problem+json' } },
  )

/** A fake server with sign-in on. The session lives in this closure. */
function server(password = 'secret') {
  let signedIn = false
  return {
    'GET /api/auth/status': () => Response.json({ enabled: true, authenticated: signedIn }),
    'POST /api/auth/login': ({ body }: { body: unknown }) => {
      if ((body as { password: string }).password !== password) {
        return problem(401, 'Wrong password')
      }
      signedIn = true
      return new Response(null, { status: 204 })
    },
    'POST /api/auth/logout': () => {
      signedIn = false
      return new Response(null, { status: 204 })
    },
    'GET /api/dashboard': () =>
      signedIn ? Response.json(emptyDashboard) : problem(401, 'Sign in to continue'),
    'GET /api/applications': () =>
      signedIn
        ? Response.json({ items: [], total: 0, page: 1, page_size: 50 })
        : problem(401, 'Sign in to continue'),
    expire: () => {
      signedIn = false
    },
  }
}

test('asks for the password, rejects a wrong one, then lets you in', async () => {
  const user = userEvent.setup()
  const { expire: _expire, ...handlers } = server()
  const { api } = renderApp('/', handlers)

  const password = await screen.findByLabelText('Password')
  expect(screen.getByRole('heading', { name: 'Sign in to JobTracker' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Applications' })).not.toBeInTheDocument()

  await user.type(password, 'nope')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByText('Wrong password')).toBeInTheDocument()
  expect(password).toHaveAttribute('aria-invalid', 'true')

  await user.clear(password)
  await user.type(password, 'secret{Enter}')
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  const login = api.calls.filter((c) => c.path === '/api/auth/login').at(-1)!
  expect(login.req.body).toEqual({ password: 'secret' })
  expect(login.req.headers.get('X-Requested-With')).toBe('jobtracker')
})

test('an expired session returns to sign-in, and sign out works', async () => {
  const user = userEvent.setup()
  const { expire, ...handlers } = server()
  renderApp('/', handlers)
  await user.type(await screen.findByLabelText('Password'), 'secret{Enter}')
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()

  // Sign out from the sidebar.
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(await screen.findByLabelText('Password')).toBeInTheDocument()

  // Sign in again, then let the session expire server-side: the next API call answers 401,
  // and the app goes back to sign-in.
  await user.type(screen.getByLabelText('Password'), 'secret{Enter}')
  await screen.findByRole('heading', { name: 'Dashboard' })
  expire()
  await user.keyboard('ga')
  await waitFor(() => expect(screen.getByLabelText('Password')).toBeInTheDocument())
})

test('no sign-in screen when sign-in is off', async () => {
  renderApp('/', { 'GET /api/dashboard': () => Response.json(emptyDashboard) })
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
})
