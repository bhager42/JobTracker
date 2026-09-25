import { useNavigate, useSearch } from '@tanstack/react-router'
import { BarChart3, CalendarRange, X } from 'lucide-react'

import {
  useMetricsBySource,
  useMetricsFunnel,
  useMetricsSummary,
  useMetricsTimeseries,
} from '@/api/metrics'
import { EmptyState } from '@/components/empty-state'
import {
  BySourceChart,
  FunnelChart,
  OutcomesChart,
  OverTimeChart,
  StatusBreakdownChart,
} from '@/components/metrics-charts'
import { MultiSelectFilter } from '@/components/multi-select-filter'
import { PageHeader } from '@/components/page-header'
import { StatTile } from '@/components/stat-tile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatDate } from '@/lib/dates'
import { SOURCE_LABELS, WORK_MODE_LABELS } from '@/lib/enums'
import {
  GRANULARITIES,
  PRESETS,
  resolveMetrics,
  type MetricsSearch,
  type Preset,
} from '@/lib/metrics-search'
import { percent } from '@/lib/format'
import { STATUS_LABELS } from '@/lib/status'

export function MetricsPage() {
  const search = useSearch({ from: '/metrics' })
  const navigate = useNavigate({ from: '/metrics' })
  const { preset, granularity, query } = resolveMetrics(search)
  const set = (patch: Partial<MetricsSearch>) =>
    navigate({ search: (prev: MetricsSearch) => ({ ...prev, ...patch }), replace: true })

  const summary = useMetricsSummary(query)
  const series = useMetricsTimeseries(query, granularity)
  const funnel = useMetricsFunnel(query)
  const sources = useMetricsBySource(query)
  const filtered = Boolean(search.status || search.source || search.work_mode)

  return (
    <>
      <PageHeader title="Metrics" description="How your search is going, over any period." />

      {/* One filter row above everything it scopes: every number below uses this slice. */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Metrics filters">
        <ToggleGroup
          type="single"
          variant="outline"
          value={granularity}
          onValueChange={(v) => v && set({ granularity: v as keyof typeof GRANULARITIES })}
          aria-label="Granularity"
        >
          {Object.entries(GRANULARITIES).map(([key, label]) => (
            <ToggleGroupItem key={key} value={key}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select
          value={preset}
          onValueChange={(v) => set({ preset: v as Preset, granularity: undefined })}
        >
          <SelectTrigger aria-label="Date range" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESETS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset === 'custom' && (
          <CustomRange
            from={search.from}
            to={search.to}
            onChange={(from, to) => set({ from, to })}
          />
        )}
        <MultiSelectFilter
          title="Status"
          labels={STATUS_LABELS}
          selected={search.status ?? []}
          onChange={(status) => set({ status })}
        />
        <MultiSelectFilter
          title="Source"
          labels={SOURCE_LABELS}
          selected={search.source ?? []}
          onChange={(source) => set({ source })}
        />
        <MultiSelectFilter
          title="Work mode"
          labels={WORK_MODE_LABELS}
          selected={search.work_mode ?? []}
          onChange={(work_mode) => set({ work_mode })}
        />
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => set({ status: undefined, source: undefined, work_mode: undefined })}
          >
            Reset filters
            <X data-icon="inline-end" />
          </Button>
        )}
        <p className="ml-auto text-xs text-muted-foreground tabular-nums">
          {query.from || query.to
            ? `${query.from ? formatDate(query.from) : 'Start'} – ${query.to ? formatDate(query.to) : 'today'}`
            : 'All time'}
        </p>
      </div>

      {summary.isPending ? (
        <MetricsSkeleton />
      ) : summary.isError ? (
        <EmptyState
          icon={BarChart3}
          title="Could not load metrics"
          description={summary.error.message}
        />
      ) : (
        <>
          <section
            aria-label="Key numbers"
            className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 lg:grid-cols-5 ${summary.isPlaceholderData ? 'opacity-60' : ''}`}
          >
            <StatTile label="Applied" value={summary.data.total_applied} />
            <StatTile
              label="Response rate"
              value={percent(summary.data.response_rate)}
              hint={`${summary.data.responded} heard back`}
            />
            <StatTile
              label="Interview rate"
              value={percent(summary.data.interview_rate)}
              hint={`${summary.data.interviewed} interviewed`}
            />
            <StatTile
              label="Offer rate"
              value={percent(summary.data.offer_rate)}
              hint={`${summary.data.offered} offers`}
            />
            <StatTile
              label="Median days to first response"
              value={
                summary.data.median_days_to_first_response === null
                  ? '—'
                  : Math.round(summary.data.median_days_to_first_response * 10) / 10
              }
              hint="From applying to any reply"
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            {series.data ? (
              <OverTimeChart
                buckets={series.data.buckets}
                granularity={series.data.granularity}
                dimmed={series.isPlaceholderData}
              />
            ) : (
              <Skeleton className="h-80 rounded-xl lg:col-span-2" />
            )}
            <StatusBreakdownChart summary={summary.data} dimmed={summary.isPlaceholderData} />
            {funnel.data ? (
              <FunnelChart stages={funnel.data.stages} dimmed={funnel.isPlaceholderData} />
            ) : (
              <Skeleton className="h-64 rounded-xl" />
            )}
            <OutcomesChart summary={summary.data} dimmed={summary.isPlaceholderData} />
            {sources.data ? (
              <BySourceChart sources={sources.data.sources} dimmed={sources.isPlaceholderData} />
            ) : (
              <Skeleton className="h-64 rounded-xl" />
            )}
          </div>
        </>
      )}
    </>
  )
}

function CustomRange({
  from,
  to,
  onChange,
}: {
  from?: string
  to?: string
  onChange: (from?: string, to?: string) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <CalendarRange data-icon="inline-start" />
          {from || to
            ? `${from ? formatDate(from) : '…'} – ${to ? formatDate(to) : '…'}`
            : 'Pick dates'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-64 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="metrics-from">From</Label>
          <Input
            id="metrics-from"
            type="date"
            value={from ?? ''}
            max={to}
            onChange={(e) => onChange(e.target.value || undefined, to)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="metrics-to">To</Label>
          <Input
            id="metrics-to"
            type="date"
            value={to ?? ''}
            min={from}
            onChange={(e) => onChange(from, e.target.value || undefined)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MetricsSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}
