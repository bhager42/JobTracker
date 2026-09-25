import { useQueryClient } from '@tanstack/react-query'
import { BriefcaseBusiness, Loader2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { authKey, useAuthStatus, useLogin } from '@/api/auth'
import { UNAUTHORIZED_EVENT } from '@/api/client'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorProps } from '@/lib/aria'

/**
 * Shows the sign-in screen instead of the app when sign-in is on (AUTH_PASSWORD) and there's
 * no valid session. Any 401 from the API (an expired session) brings it back.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const status = useAuthStatus()

  useEffect(() => {
    const recheck = () => void client.invalidateQueries({ queryKey: authKey })
    window.addEventListener(UNAUTHORIZED_EVENT, recheck)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, recheck)
  }, [client])

  if (status.isPending) {
    return (
      <div className="grid min-h-svh place-items-center" aria-busy="true">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }
  // If the status call itself fails, let the app render and show its own errors.
  if (status.data?.enabled && !status.data.authenticated) return <SignIn />
  return children
}

function SignIn() {
  const login = useLogin()
  const [password, setPassword] = useState('')
  const error = login.error?.message

  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BriefcaseBusiness className="size-5" />
          </div>
          <CardTitle>
            <h1>Sign in to JobTracker</h1>
          </CardTitle>
          <CardDescription>Enter the password set for this server.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (password) login.mutate(password)
            }}
          >
            {/* Lets password managers pair the saved password with this server. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="jobtracker"
              readOnly
              hidden
            />
            <FormField label="Password" htmlFor="password" error={error}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                {...errorProps('password', error)}
              />
            </FormField>
            <Button type="submit" disabled={!password || login.isPending}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
