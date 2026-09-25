import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { presetRange, resolveMetrics, validateMetricsSearch } from '@/lib/metrics-search'
import { renderApp } from '@/test/render-app'

const TODAY = new Date(2026, 2, 11, 12) // Wednesday, March 11 2026, local time

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('metrics presets', () => {
  test('ranges start on ISO week / month / year boundaries', () => {
    // 12 weeks back from Wed 11 March, aligned to Monday.
    expect(presetRange('12w', TODAY)).toEqual({ from: '2025-12-22', to: '2026-03-11' })
    expect(presetRange('12m', TODAY)).toEqual({ from: '2025-04-01', to: '2026-03-11' })
    expect(presetRange('ytd', TODAY)).toEqual({ from: '2026-01-01', to: '2026-03-11' })
    expect(presetRange('all', TODAY)).toEqual({})
  })

  test('defaults to the last 12 months, monthly; each preset has a natural granularity', () => {
    expect(resolveMetrics({}, TODAY)).toMatchObject({ preset: '12m', granularity: 'month' })
    expect(resolveMetrics({ preset: '12w' }, TODAY).granularity).toBe('week')
    expect(resolveMetrics({ preset: '12w', granularity: 'year' }, TODAY).granularity).toBe('year')
    expect(
      resolveMetrics({ preset: 'custom', from: '2025-01-01', to: '2025-06-30' }, TODAY).query,
    ).toMatchObject({ from: '2025-01-01', to: '2025-06-30' })
  })

  test('invalid URL params are dropped', () => {
    expect(
      validateMetricsSearch({ preset: 'forever', granularity: 'day', source: 'linkedin' }),
    ).toEqual({ source: ['linkedin'] })
  })
})

const summary = {
  total_applied: 40,
  responded: 18,
  interviewed: 10,
  offered: 3,
  accepted: 1,
  response_rate: 0.45,
  interview_rate: 0.25,
  offer_rate: 0.075,
  median_days_to_first_response: 6.5,
  status_breakdown: [
    { status: 'applied', count: 12 },
    { status: 'interviewing', count: 4 },
    { status: 'not_selected', count: 9 },
  ],
  outcomes: {
    rejected_no_interview: 5,
    rejected_after_interview: [
      { rounds: 1, count: 3 },
      { rounds: 2, count: 2 },
    ],
    ghosted: 9,
    withdrawn: 1,
    declined: 1,
    position_closed: 0,
  },
}
const handlers = {
  'GET /api/metrics/summary': () => Response.json(summary),
  'GET /api/metrics/timeseries': ({ url }: { url: URL }) =>
    Response.json({
      granularity: url.searchParams.get('granularity'),
      buckets: [
        {
          start: '2026-02-01',
          end: '2026-02-28',
          label: '2026-02',
          total: 15,
          by_group: { active: 8, closed_positive: 1, closed_neutral: 1, closed_negative: 5 },
        },
        {
          start: '2026-03-01',
          end: '2026-03-31',
          label: '2026-03',
          total: 25,
          by_group: { active: 20, closed_positive: 0, closed_neutral: 1, closed_negative: 4 },
        },
      ],
    }),
  'GET /api/metrics/funnel': () =>
    Response.json({
      stages: [
        { stage: 'applied', count: 40, rate: 1 },
        { stage: 'screening', count: 18, rate: 0.45 },
        { stage: 'interviewing', count: 10, rate: 0.25 },
        { stage: 'offer', count: 3, rate: 0.075 },
        { stage: 'accepted', count: 1, rate: 0.025 },
      ],
    }),
  'GET /api/metrics/by-source': () =>
    Response.json({
      sources: [
        {
          source: 'linkedin',
          applications: 30,
          responses: 12,
          interviews: 6,
          response_rate: 0.4,
          interview_rate: 0.2,
        },
        {
          source: null,
          applications: 10,
          responses: 6,
          interviews: 4,
          response_rate: 0.6,
          interview_rate: 0.4,
        },
      ],
    }),
}

describe('Metrics page', () => {
  test('shows the KPI row and every chart has a table view with the exact numbers', async () => {
    const user = userEvent.setup()
    renderApp('/metrics', handlers)
    const kpis = await screen.findByRole('region', { name: 'Key numbers' })
    for (const text of ['40', '45%', '25%', '8%', '6.5']) {
      expect(within(kpis).getByText(text)).toBeInTheDocument()
    }

    const card = (title: string) =>
      screen.getByText(title, { selector: '[data-slot=card-title]' }).closest('[data-slot=card]')!
    const tableOf = async (title: string) => {
      await user.click(
        within(card(title) as HTMLElement).getByRole('button', { name: 'View as table' }),
      )
      return within(card(title) as HTMLElement).getByRole('table', { name: title })
    }

    expect(await tableOf('Applications over time')).toHaveTextContent('March 2026252001')
    expect(await tableOf('Current status')).toHaveTextContent('Not Selected (No Response)9')
    const funnel = await tableOf('Pipeline funnel')
    expect(funnel).toHaveTextContent('Interviewing1025%')
    expect(await tableOf('Outcomes')).toHaveTextContent('Rejected after round 22')
    expect(await tableOf('By source')).toHaveTextContent('Not set106440%')
  })

  test('one filter row scopes every chart: a filter reaches all four endpoints', async () => {
    const user = userEvent.setup()
    const { api } = renderApp('/metrics', handlers)
    await screen.findByRole('region', { name: 'Key numbers' })
    const first = api.calls.filter((c) => c.path.startsWith('/api/metrics'))
    expect(first).toHaveLength(4)
    for (const c of first) {
      expect(c.req.url.searchParams.get('from')).toBe('2025-04-01')
      expect(c.req.url.searchParams.get('to')).toBe('2026-03-11')
    }

    await user.click(screen.getByRole('button', { name: /^Source/ }))
    await user.click(await screen.findByLabelText('LinkedIn'))
    await waitFor(() => {
      const filtered = api.calls.filter(
        (c) => c.path.startsWith('/api/metrics') && c.req.url.searchParams.get('source'),
      )
      expect(new Set(filtered.map((c) => c.path))).toEqual(
        new Set([
          '/api/metrics/summary',
          '/api/metrics/timeseries',
          '/api/metrics/funnel',
          '/api/metrics/by-source',
        ]),
      )
    })
  })

  test('changing granularity refetches the time series with it', async () => {
    const user = userEvent.setup()
    const { api } = renderApp('/metrics', handlers)
    await screen.findByRole('region', { name: 'Key numbers' })
    await user.click(screen.getByRole('radio', { name: 'Weekly' }))
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) =>
            c.path === '/api/metrics/timeseries' &&
            c.req.url.searchParams.get('granularity') === 'week',
        ),
      ).toBe(true),
    )
  })
})
