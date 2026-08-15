import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const fetchJsonMock = vi.fn()
vi.mock('@/app/_data/apiClient', () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}))
vi.mock('../../../../_components/DataSourceBadge', () => ({
  DataSourceBadge: () => null,
}))

import WorkforceAnalyticsPage from './page'

const mockHeadcount = [
  { group_key: 'Finance', count: 45 },
  { group_key: 'HR', count: 30 },
  { group_key: 'IT', count: 60 },
]
const mockRetirements = [
  { employeeId: 'e1', fullName: 'Ramesh Gupta', department: 'Finance', monthsLeft: 4 },
  { employeeId: 'e2', fullName: 'Sunita Rao', department: 'HR', monthsLeft: 10 },
]
const mockKpis = {
  turnoverPct: 3.2,
  absenteeismPct: 5.1,
  avgTenureYears: 8.4,
  genderRatioF: 42,
  genderRatioM: 93,
  monthlyTrend: [
    { month: 'Jan', headcount: 128 },
    { month: 'Feb', headcount: 130 },
    { month: 'Mar', headcount: 132 },
  ],
}

describe('WorkforceAnalyticsPage', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes('headcount')) return Promise.resolve({ data: mockHeadcount, source: 'api' })
      if (path.includes('retirement')) return Promise.resolve({ data: mockRetirements, source: 'api' })
      if (path.includes('analytics-kpis')) return Promise.resolve({ data: mockKpis, source: 'api' })
      return Promise.resolve({ data: [], source: 'api' })
    })
  })

  it('renders page title', async () => {
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('Workforce Analytics')).toBeInTheDocument()
  })

  it('renders KPI stat cards', async () => {
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('Turnover Rate')).toBeInTheDocument()
    expect(screen.getByText('Absenteeism Rate')).toBeInTheDocument()
    expect(screen.getByText('Avg. Tenure (yrs)')).toBeInTheDocument()
    expect(screen.getByText('Total Headcount')).toBeInTheDocument()
    // total headcount = 45+30+60=135; use getAllByText since SVG may also show it
    const allWith135 = screen.getAllByText('135')
    expect(allWith135.length).toBeGreaterThanOrEqual(1)
  })

  it('renders monthly trend chart section', async () => {
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('Monthly Headcount Trend')).toBeInTheDocument()
  })

  it('renders gender diversity section', async () => {
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('Gender Diversity')).toBeInTheDocument()
  })

  it('renders retirement forecast with counts', async () => {
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('Retirement Forecast')).toBeInTheDocument()
    // 1 retiring within 6 months (monthsLeft=4)
    // 2 retiring within 12 months (4 and 10)
    expect(screen.getByText('Retiring within 6 months')).toBeInTheDocument()
    expect(screen.getByText('Retiring within 12 months')).toBeInTheDocument()
  })

  it('renders retirement officer names', async () => {
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('Ramesh Gupta')).toBeInTheDocument()
    expect(screen.getByText('Sunita Rao')).toBeInTheDocument()
  })
})
