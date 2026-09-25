/**
 * Metrics charts (PLAN.md §7.5), built to the dataviz rules: thin bars (<= 24px, 4px rounded
 * data end, square at the baseline), hairline grids, one hue for nominal categories, a
 * validated one-hue ramp for the ordered funnel, categorical slots only for stacked groups,
 * a hover tooltip on every mark, and a table view for every chart. Colors are the `--viz-*`
 * tokens in index.css; text always uses text tokens, never a series color.
 */
import { format, parseISO } from 'date-fns'
import { BarChart3, Table2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts'

import type {
  FunnelStage,
  Granularity,
  MetricsSummary,
  SourceMetrics,
  TimeseriesBucket,
} from '@/api/metrics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { SOURCE_LABELS } from '@/lib/enums'
import { STATUS_META } from '@/lib/status'
import { percent } from '@/lib/format'
import { cn } from '@/lib/utils'

const BAR = 24
const ROW = 32 // px per horizontal bar row
// 150–200ms motion (PLAN.md §14), and none for people who ask for reduced motion.
const ANIMATE =
  typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
const MOTION = { isAnimationActive: ANIMATE, animationDuration: 200 } as const
const GRID = 'var(--viz-grid)'
const TICK = { fontSize: 12 }

// --- the card every chart sits in -------------------------------------------------------

interface TableData {
  columns: string[]
  rows: (string | number)[][]
}

export function ChartCard({
  title,
  description,
  table,
  empty,
  dimmed,
  actions,
  className,
  children,
}: {
  title: string
  description?: string
  table: TableData
  empty?: boolean
  dimmed?: boolean
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <Card className={cn('gap-3', className)}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex items-center gap-3">
          {!asTable && actions}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            disabled={empty}
          >
            {asTable ? <BarChart3 data-icon="inline-start" /> : <Table2 data-icon="inline-start" />}
            {asTable ? 'View as chart' : 'View as table'}
          </Button>
        </div>
      </CardHeader>
      {/* Refetches keep the previous render, dimmed, instead of flashing a skeleton. */}
      <CardContent className={cn('transition-opacity', dimmed && 'opacity-60')}>
        {empty ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No applications in this range.
          </p>
        ) : asTable ? (
          <DataTable {...table} caption={title} />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

function DataTable({ columns, rows, caption }: TableData & { caption: string }) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn('px-3 py-2 font-medium', i > 0 && 'text-right')}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="px-3 py-1.5 text-left font-normal">
                    {cell}
                  </th>
                ) : (
                  <td key={i} className="px-3 py-1.5 text-right tabular-nums">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- 1. applications over time ------------------------------------------------------------

const GROUPS = {
  active: { label: 'Active', color: 'var(--viz-1)' },
  closed_positive: { label: 'Accepted', color: 'var(--viz-2)' },
  closed_neutral: { label: 'Declined, withdrawn, or closed', color: 'var(--viz-3)' },
  closed_negative: { label: 'Rejected or no response', color: 'var(--viz-4)' },
} satisfies ChartConfig
type GroupKey = keyof typeof GROUPS
const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[]

const AXIS_FORMAT: Record<Granularity, string> = { week: 'MMM d', month: 'MMM yy', year: 'yyyy' }

function bucketTitle(b: TimeseriesBucket, granularity: Granularity): string {
  const start = parseISO(b.start)
  if (granularity === 'week') return `Week of ${format(start, 'MMM d, yyyy')} (${b.label})`
  if (granularity === 'month') return format(start, 'MMMM yyyy')
  return b.label
}

export function OverTimeChart({
  buckets,
  granularity,
  dimmed,
}: {
  buckets: TimeseriesBucket[]
  granularity: Granularity
  dimmed?: boolean
}) {
  const [stacked, setStacked] = useState(false)
  const data = buckets.map((b) => ({
    title: bucketTitle(b, granularity),
    axis: format(parseISO(b.start), AXIS_FORMAT[granularity]),
    total: b.total,
    ...b.by_group,
  }))
  const config: ChartConfig = stacked
    ? GROUPS
    : { total: { label: 'Applications', color: 'var(--viz-1)' } }

  return (
    <ChartCard
      title="Applications over time"
      description={`By date applied, per ${granularity}.`}
      empty={buckets.every((b) => b.total === 0)}
      dimmed={dimmed}
      className="lg:col-span-2"
      actions={
        <div className="flex items-center gap-2">
          <Switch id="stack-groups" checked={stacked} onCheckedChange={setStacked} />
          <Label htmlFor="stack-groups" className="text-xs font-normal">
            Split by outcome
          </Label>
        </div>
      }
      table={{
        columns: ['Period', 'Total', ...GROUP_KEYS.map((k) => GROUPS[k].label)],
        rows: data.map((d) => [d.title, d.total, ...GROUP_KEYS.map((k) => d[k])]),
      }}
    >
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="axis"
            tickLine={false}
            axisLine={{ stroke: GRID }}
            tick={TICK}
            minTickGap={16}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} width={40} />
          <ChartTooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(_, payload) => payload?.[0]?.payload?.title}
              />
            }
          />
          {stacked ? (
            GROUP_KEYS.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="groups"
                {...MOTION}
                fill={`var(--color-${k})`}
                maxBarSize={BAR}
                // A 2px surface gap between stacked segments; only the top end is rounded.
                stroke="var(--card)"
                strokeWidth={1}
                radius={i === GROUP_KEYS.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))
          ) : (
            <Bar
              dataKey="total"
              {...MOTION}
              fill="var(--color-total)"
              maxBarSize={BAR}
              radius={[4, 4, 0, 0]}
            />
          )}
          {stacked && (
            <ChartLegend
              // Recharts sorts legend items by name; keep them in stack order instead.
              itemSorter={(item) => GROUP_KEYS.indexOf(item.dataKey as GroupKey)}
              content={<ChartLegendContent />}
            />
          )}
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}

// --- horizontal bar charts ------------------------------------------------------------------

interface Row {
  label: string
  value: number
  display: string
  fill?: string
}

/** One hue (slot 1) for nominal rows, value at the bar tip, tooltip on hover. */
function HorizontalBars({
  rows,
  valueLabel,
  labelWidth = 170,
  domainMax,
}: {
  rows: Row[]
  valueLabel: string
  labelWidth?: number
  domainMax?: number
}) {
  const config = { value: { label: valueLabel, color: 'var(--viz-1)' } } satisfies ChartConfig
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: rows.length * ROW + 16 }}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" hide domain={[0, domainMax ?? 'auto']} />
        <YAxis
          type="category"
          dataKey="label"
          width={labelWidth}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          tick={TICK}
          interval={0}
        />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          content={
            <ChartTooltipContent
              indicator="line"
              formatter={(_value, _name, item) => (
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {(item.payload as Row).display}
                </span>
              )}
            />
          }
        />
        <Bar
          dataKey="value"
          {...MOTION}
          fill="var(--color-value)"
          maxBarSize={20}
          radius={[0, 4, 4, 0]}
        >
          {rows.map((r) => (
            <Cell key={r.label} fill={r.fill ?? 'var(--color-value)'} />
          ))}
          <LabelList dataKey="display" position="right" className="fill-foreground" fontSize={12} />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// --- 2. status breakdown --------------------------------------------------------------------

export function StatusBreakdownChart({
  summary,
  dimmed,
}: {
  summary: MetricsSummary
  dimmed?: boolean
}) {
  const rows = summary.status_breakdown.map((s) => ({
    label: STATUS_META[s.status].label,
    value: s.count,
    display: String(s.count),
  }))
  return (
    <ChartCard
      title="Current status"
      description="Where the applications in this range stand today."
      empty={summary.total_applied === 0}
      dimmed={dimmed}
      table={{ columns: ['Status', 'Applications'], rows: rows.map((r) => [r.label, r.value]) }}
    >
      <HorizontalBars rows={rows} valueLabel="Applications" labelWidth={220} />
    </ChartCard>
  )
}

// --- 3. funnel ------------------------------------------------------------------------------

export function FunnelChart({ stages, dimmed }: { stages: FunnelStage[]; dimmed?: boolean }) {
  // Ordered stages: a one-hue ramp, darkest (most) to lightest (fewest).
  const rows = stages.map((s, i) => ({
    label: STATUS_META[s.stage].label,
    value: s.count,
    display: i === 0 ? String(s.count) : `${s.count} · ${percent(s.rate)}`,
    fill: `var(--viz-ramp-${i + 1})`,
  }))
  return (
    <ChartCard
      title="Pipeline funnel"
      description="Every stage each application reached or passed."
      empty={(stages[0]?.count ?? 0) === 0}
      dimmed={dimmed}
      table={{
        columns: ['Stage', 'Applications', 'Of applied'],
        rows: stages.map((s) => [STATUS_META[s.stage].label, s.count, percent(s.rate)]),
      }}
    >
      <HorizontalBars rows={rows} valueLabel="Reached" labelWidth={130} />
    </ChartCard>
  )
}

// --- 4. outcomes ----------------------------------------------------------------------------

export function OutcomesChart({ summary, dimmed }: { summary: MetricsSummary; dimmed?: boolean }) {
  const o = summary.outcomes
  const rows: Row[] = [
    { label: 'Rejected, no interview', value: o.rejected_no_interview },
    ...o.rejected_after_interview.map((r) => ({
      label: r.rounds > 0 ? `Rejected after round ${r.rounds}` : 'Rejected after interview',
      value: r.count,
    })),
    { label: 'No response (ghosted)', value: o.ghosted },
    { label: 'Withdrew', value: o.withdrawn },
    { label: 'Declined an offer', value: o.declined },
    { label: 'Position closed', value: o.position_closed },
  ].map((r) => ({ ...r, display: String(r.value) }))
  return (
    <ChartCard
      title="Outcomes"
      description="How closed applications ended."
      empty={rows.every((r) => r.value === 0)}
      dimmed={dimmed}
      table={{ columns: ['Outcome', 'Applications'], rows: rows.map((r) => [r.label, r.value]) }}
    >
      <HorizontalBars rows={rows} valueLabel="Applications" />
    </ChartCard>
  )
}

// --- 5. by source ---------------------------------------------------------------------------

export function BySourceChart({ sources, dimmed }: { sources: SourceMetrics[]; dimmed?: boolean }) {
  const name = (s: SourceMetrics) => (s.source ? SOURCE_LABELS[s.source] : 'Not set')
  const counts = sources.map((s) => ({
    label: name(s),
    value: s.applications,
    display: String(s.applications),
  }))
  const rates = sources.map((s) => ({
    label: name(s),
    value: s.interview_rate ?? 0,
    display: percent(s.interview_rate),
  }))
  // Two measures on different scales: two small charts on one row order, never a dual axis.
  return (
    <ChartCard
      title="By source"
      description="Which channels you use, and which lead to interviews."
      empty={sources.length === 0}
      dimmed={dimmed}
      className="lg:col-span-2"
      table={{
        columns: ['Source', 'Applications', 'Responses', 'Interviews', 'Interview rate'],
        rows: sources.map((s) => [
          name(s),
          s.applications,
          s.responses,
          s.interviews,
          percent(s.interview_rate),
        ]),
      }}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <figure className="grid gap-2">
          <figcaption className="text-xs font-medium text-muted-foreground">
            Applications
          </figcaption>
          <HorizontalBars rows={counts} valueLabel="Applications" labelWidth={110} />
        </figure>
        <figure className="grid gap-2">
          <figcaption className="text-xs font-medium text-muted-foreground">
            Interview rate
          </figcaption>
          <HorizontalBars rows={rates} valueLabel="Interview rate" labelWidth={110} domainMax={1} />
        </figure>
      </div>
    </ChartCard>
  )
}
