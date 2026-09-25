import { Link } from '@tanstack/react-router'
import { ArrowRight, Bot, Gift, Hourglass, LayoutDashboard } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Application } from '@/api/applications'
import { useDashboard, type ActivityItem, type Dashboard } from '@/api/dashboard'
import { AutoCloseHint } from '@/components/auto-close-hint'
import { EmptyState } from '@/components/empty-state'
import { NewApplicationButton } from '@/components/new-application-button'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatRelative } from '@/lib/dates'
import { STATUS_META, TONE_DOT } from '@/lib/status'
import { cn } from '@/lib/utils'

export function DashboardPage() {
  const { data, isPending, isError, error } = useDashboard()
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your job search at a glance."
        actions={<NewApplicationButton />}
      />
      {isPending ? (
        <DashboardSkeleton />
      ) : isError ? (
        <EmptyState icon={LayoutDashboard} title="Could not load" description={error.message} />
      ) : data.kpis.total_applied === 0 && data.recent_activity.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="Nothing to show yet"
          description="Add your first application and this page fills with numbers, reminders, and activity."
          action={<NewApplicationButton />}
        />
      ) : (
        <DashboardBody data={data} />
      )}
    </>
  )
}

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)

function DashboardBody({ data }: { data: Dashboard }) {
  const { kpis } = data
  const attention = data.auto_closing_soon.length + data.offers_awaiting_decision.length
  return (
    <>
      <section
        aria-label="Key numbers"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        <Kpi label="Applied this week" value={kpis.applied_this_week} />
        <Kpi label="Applied this month" value={kpis.applied_this_month} />
        <Kpi
          label="Active pipeline"
          value={kpis.active_pipeline}
          hint="Applied through offer"
          to="/applications"
          search={{ status: ['applied', 'screening', 'interviewing', 'offer'] }}
        />
        <Kpi
          label="Interview rate"
          value={percent(kpis.interview_rate)}
          hint={`of ${kpis.total_applied} applied`}
        />
        <Kpi
          label="Response rate"
          value={percent(kpis.response_rate)}
          hint={`of ${kpis.total_applied} applied`}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>
              {attention === 0
                ? 'Nothing waiting on you right now.'
                : 'Applications about to auto-close, and offers waiting on your decision.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {data.offers_awaiting_decision.length > 0 && (
              <AttentionList
                icon={<Gift className="size-4" />}
                title="Offers awaiting a decision"
                apps={data.offers_awaiting_decision}
                detail={(app) => `Offer received ${formatRelative(app.status_changed_at)}`}
              />
            )}
            {data.auto_closing_soon.length > 0 && (
              <AttentionList
                icon={<Hourglass className="size-4" />}
                title="Auto-closing within 7 days"
                apps={data.auto_closing_soon}
                detail={(app) => <AutoCloseHint autoCloseAt={app.auto_close_at} />}
              />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed items={data.recent_activity} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function Kpi({
  label,
  value,
  hint,
  to,
  search,
}: {
  label: string
  value: number | string
  hint?: string
  to?: '/applications'
  search?: { status: ('applied' | 'screening' | 'interviewing' | 'offer')[] }
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  )
  const className = 'block rounded-xl border bg-card p-4'
  return to ? (
    <Link to={to} search={search} className={cn(className, 'transition-colors hover:bg-muted/50')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

function AttentionList({
  icon,
  title,
  apps,
  detail,
}: {
  icon: ReactNode
  title: string
  apps: Application[]
  detail: (app: Application) => ReactNode
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
        <span className="font-mono tabular-nums">({apps.length})</span>
      </h3>
      <ul className="divide-y rounded-lg border">
        {apps.map((app) => (
          <li key={app.id}>
            <Link
              to="/applications/$id"
              params={{ id: String(app.id) }}
              className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{app.company}</p>
                <p className="truncate text-xs text-muted-foreground">{app.job_title}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{detail(app)}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>
  return (
    <ol className="grid gap-3" aria-label="Recent activity">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 text-sm">
          <span
            aria-hidden
            className={cn(
              'mt-1.5 size-2 shrink-0 rounded-full',
              TONE_DOT[STATUS_META[item.to_status].tone],
            )}
          />
          <div className="min-w-0 flex-1">
            <p>
              <Link
                to="/applications/$id"
                params={{ id: String(item.application_id) }}
                className="font-medium hover:underline"
              >
                {item.company}
              </Link>{' '}
              <span className="text-muted-foreground">
                {item.from_status === null ? 'added as' : 'moved to'}
              </span>{' '}
              <StatusBadge status={item.to_status} className="align-middle" />
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              {item.source === 'automation' && (
                <Bot className="size-3.5" aria-label="Automatically" />
              )}
              <time dateTime={item.changed_at} title={formatDateTime(item.changed_at)}>
                {formatRelative(item.changed_at)}
              </time>
              <span className="truncate">· {item.job_title}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-64 rounded-xl lg:col-span-3" />
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
      </div>
    </div>
  )
}
