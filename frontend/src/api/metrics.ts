import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '@/api/client'
import type { operations } from '@/api/schema.gen'

export type MetricsQuery = NonNullable<
  operations['get_summary_api_metrics_summary_get']['parameters']['query']
>
export type Granularity = Schemas['MetricsTimeseries']['granularity']
export type MetricsSummary = Schemas['MetricsSummary']
export type TimeseriesBucket = Schemas['TimeseriesBucket']
export type FunnelStage = Schemas['FunnelStage']
export type SourceMetrics = Schemas['SourceMetrics']

// Under "applications" so any change to an application refreshes the metrics too.
// Previous data stays on screen (dimmed) while a new slice loads, so charts don't flash.
const key = (name: string, query: object) => ['applications', 'metrics', name, query] as const

export function useMetricsSummary(query: MetricsQuery) {
  return useQuery({
    queryKey: key('summary', query),
    queryFn: () => unwrap(api.GET('/api/metrics/summary', { params: { query } })),
    placeholderData: keepPreviousData,
  })
}

export function useMetricsTimeseries(query: MetricsQuery, granularity: Granularity) {
  return useQuery({
    queryKey: key('timeseries', { ...query, granularity }),
    queryFn: () =>
      unwrap(api.GET('/api/metrics/timeseries', { params: { query: { ...query, granularity } } })),
    placeholderData: keepPreviousData,
  })
}

export function useMetricsFunnel(query: MetricsQuery) {
  return useQuery({
    queryKey: key('funnel', query),
    queryFn: () => unwrap(api.GET('/api/metrics/funnel', { params: { query } })),
    placeholderData: keepPreviousData,
  })
}

export function useMetricsBySource(query: MetricsQuery) {
  return useQuery({
    queryKey: key('by-source', query),
    queryFn: () => unwrap(api.GET('/api/metrics/by-source', { params: { query } })),
    placeholderData: keepPreviousData,
  })
}
