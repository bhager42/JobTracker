import { Monitor, Moon, Play, Sun } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useHealth } from '@/api/client'
import {
  useAbout,
  useRunAutoClose,
  useSettings,
  useUpdateAutoClose,
  type AppSettings,
} from '@/api/settings'
import { DataCard } from '@/components/data-card'
import { FormField } from '@/components/form-field'
import { PageHeader } from '@/components/page-header'
import { useTheme, type Theme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { STATUS_LABELS, type Status } from '@/lib/status'

export function SettingsPage() {
  const { data, isPending, isError, error } = useSettings()
  return (
    <>
      <PageHeader title="Settings" description="Automation, appearance, and data." />
      <div className="grid max-w-2xl gap-6">
        {isPending ? (
          <Skeleton className="h-72 w-full rounded-xl" />
        ) : isError ? (
          <p className="text-sm text-destructive">Couldn't load settings: {error.message}</p>
        ) : (
          // Remount when saved values change so the form starts from them.
          <AutoCloseCard key={JSON.stringify(data.auto_close)} settings={data} />
        )}
        <DataCard />
        <AppearanceCard />
        <AboutCard />
      </div>
    </>
  )
}

function AutoCloseCard({ settings }: { settings: AppSettings }) {
  const saved = settings.auto_close
  const update = useUpdateAutoClose()
  const runNow = useRunAutoClose()
  const [enabled, setEnabled] = useState(saved.enabled)
  const [days, setDays] = useState(String(saved.days))
  const [statuses, setStatuses] = useState<Status[]>(saved.statuses)

  const daysNum = Number(days)
  const daysValid = /^\d+$/.test(days) && daysNum >= 1 && daysNum <= 365
  const statusesValid = statuses.length > 0
  const dirty =
    enabled !== saved.enabled || daysNum !== saved.days || statuses.join() !== saved.statuses.join()

  const save = async () => {
    try {
      await update.mutateAsync({ enabled, days: daysNum, statuses })
      toast.success('Auto-close settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings')
    }
  }

  const run = async () => {
    try {
      const result = await runNow.mutateAsync()
      toast.success(
        result.closed === 0
          ? 'Nothing to close right now'
          : `Closed ${result.closed} application${result.closed === 1 ? '' : 's'}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Auto-close run failed')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-close</CardTitle>
        <CardDescription>
          Applications with no status change for a while are marked “Not Selected (No Response)”. It
          runs at startup and every hour, and every close can be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="ac-enabled" className="grid gap-1">
            <span>Enable auto-close</span>
            <span className="text-xs font-normal text-muted-foreground">
              When off, nothing is closed automatically.
            </span>
          </Label>
          <Switch id="ac-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <FormField
          label="Close after (days without an update)"
          htmlFor="ac-days"
          error={daysValid ? undefined : 'Enter a number from 1 to 365'}
          className="max-w-xs"
        >
          <Input
            id="ac-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={days}
            disabled={!enabled}
            onChange={(e) => setDays(e.target.value)}
            aria-invalid={!daysValid || undefined}
          />
        </FormField>

        <fieldset className="grid gap-2" disabled={!enabled}>
          <legend className="mb-1 text-sm font-medium">Statuses that can auto-close</legend>
          {settings.auto_close_allowed_statuses.map((status) => (
            <div key={status} className="flex items-center gap-2">
              <Checkbox
                id={`ac-status-${status}`}
                checked={statuses.includes(status)}
                disabled={!enabled}
                onCheckedChange={(on) =>
                  setStatuses((prev) =>
                    on === true
                      ? settings.auto_close_allowed_statuses.filter(
                          (s) => s === status || prev.includes(s),
                        )
                      : prev.filter((s) => s !== status),
                  )
                }
              />
              <Label htmlFor={`ac-status-${status}`} className="font-normal">
                {STATUS_LABELS[status]}
              </Label>
            </div>
          ))}
          {!statusesValid && (
            <p role="alert" className="text-xs text-destructive">
              Pick at least one status, or turn auto-close off.
            </p>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button
            variant="outline"
            onClick={run}
            disabled={!saved.enabled || dirty || runNow.isPending}
            title={dirty ? 'Save your changes first' : undefined}
          >
            <Play data-icon="inline-start" />
            {runNow.isPending ? 'Running…' : 'Run now'}
          </Button>
          <Button
            onClick={save}
            disabled={!dirty || !daysValid || !statusesValid || update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function AppearanceCard() {
  const { theme, setTheme } = useTheme()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Saved in this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          value={theme}
          onValueChange={(v) => v && setTheme(v as Theme)}
          aria-label="Theme"
        >
          {THEMES.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value}>
              <Icon data-icon="inline-start" />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}

function AboutCard() {
  const about = useAbout()
  const health = useHealth()
  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>Server build and storage.</CardDescription>
      </CardHeader>
      <CardContent>
        {about.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : about.isError ? (
          <p className="text-sm text-destructive">Couldn't reach the API.</p>
        ) : (
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono tabular-nums">{about.data.version}</dd>
            <dt className="text-muted-foreground">Build</dt>
            <dd className="font-mono">{about.data.build_sha}</dd>
            <dt className="text-muted-foreground">Data path</dt>
            <dd className="font-mono break-all">{about.data.data_dir}</dd>
            <dt className="text-muted-foreground">Database</dt>
            <dd>{health.data?.db === 'ok' ? 'Healthy' : health.isPending ? '…' : 'Error'}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
