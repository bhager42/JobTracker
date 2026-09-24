import { useHealth } from '@/api/client'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function SettingsPage() {
  const { data, isPending, isError } = useHealth()
  return (
    <>
      <PageHeader title="Settings" description="Automation, appearance, and data." />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>Server build information.</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : isError ? (
            <p className="text-sm text-destructive">Couldn't reach the API.</p>
          ) : (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-mono tabular-nums">{data.version}</dd>
              <dt className="text-muted-foreground">Build</dt>
              <dd className="font-mono">{data.build_sha}</dd>
              <dt className="text-muted-foreground">Database</dt>
              <dd>{data.db === 'ok' ? 'Healthy' : 'Error'}</dd>
            </dl>
          )}
        </CardContent>
      </Card>
    </>
  )
}
