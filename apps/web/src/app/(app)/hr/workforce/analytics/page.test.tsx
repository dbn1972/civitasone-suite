import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

const fetchJsonMock = vi.fn()
vi.mock('@/app/_data/apiClient', async () => {
  const actual = await vi.importActual<typeof import('@/app/_data/apiClient')>('@/app/_data/apiClient')
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) }
})
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
vi.mock('../../../../_components/DataSourceBadge', () => ({
  DataSourceBadge: () => null,
}))

const getSessionRolesMock = vi.fn<() => string[]>(() => ['hr_admin'])
vi.mock('@/lib/auth/roleGuard', () => ({
  getSessionRoles: () => getSessionRolesMock(),
}))

import WorkforceAnalyticsPage, { generateMetadata } from './page'

const mockHeadcount = { data: { total: 135, breakdown: [
  { group_key: 'Finance', count: 45 },
  { group_key: 'HR', count: 30 },
  { group_key: 'IT', count: 60 },
] } }
const mockRetirements = { data: [
  { period: '2026-10', retiring_count: 1 },
  { period: '2027-03', retiring_count: 2 },
], meta: { retirementAge: 60 } }
const mockKpisSuppressed = { data: { avgTenureYears: 8.4 }, meta: { genderSuppressed: true, genderSuppressionThreshold: 10, unavailable: ['turnoverPct', 'absenteeismPct', 'monthlyTrend'] } }
const mockKpisOpen = { data: { avgTenureYears: 8.4, genderRatioF: 40, genderRatioM: 95 }, meta: { genderSuppressed: false, genderSuppressionThreshold: 10, unavailable: ['turnoverPct', 'absenteeismPct', 'monthlyTrend'] } }

function mockLoaders(overrides: {
  headcount?: { data: unknown; source: 'api' | 'error' }
  retirements?: { data: unknown; source: 'api' | 'error' }
  kpis?: { data: unknown; source: 'api' | 'error' }
  kpisBody?: unknown
}) {
  fetchJsonMock.mockImplementation((path: unknown, empty: unknown, options: { mapResponse: (p: unknown) => unknown }) => {
    if (typeof path !== 'string') return Promise.resolve({ data: empty, source: 'api' })

    if (path.includes('/hrms/workforce/headcount')) {
      if (overrides.headcount) return Promise.resolve(overrides.headcount)
      const mapped = options.mapResponse(mockHeadcount)
      return Promise.resolve({ data: mapped ?? empty, source: mapped === null ? 'error' : 'api' })
    }
    if (path.includes('/hrms/workforce/retirement-forecast')) {
      if (overrides.retirements) return Promise.resolve(overrides.retirements)
      const mapped = options.mapResponse(mockRetirements)
      return Promise.resolve({ data: mapped ?? empty, source: mapped === null ? 'error' : 'api' })
    }
    if (path.includes('/hrms/workforce/analytics-kpis')) {
      if (overrides.kpis) return Promise.resolve(overrides.kpis)
      const mapped = options.mapResponse(overrides.kpisBody ?? mockKpisSuppressed)
      return Promise.resolve({ data: mapped ?? empty, source: mapped === null ? 'error' : 'api' })
    }
    return Promise.resolve({ data: empty, source: 'api' })
  })
}

describe('WorkforceAnalyticsPage', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
    getSessionRolesMock.mockReturnValue(['hr_admin'])
  })

  it('renders page title', async () => {
    mockLoaders({})
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('title')).toBeInTheDocument()
  })

  it('renders only the two real KPI stat cards -- turnover/absenteeism are dropped, not shown as fabricated zeros (GAP-HR-WORKFORCE-ANALYTICS-01)', async () => {
    mockLoaders({})
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('statTotalHeadcount')).toBeInTheDocument()
    expect(screen.getByText('statAvgTenure')).toBeInTheDocument()
    expect(screen.queryByText('statTurnoverRate')).not.toBeInTheDocument()
    expect(screen.queryByText('statAbsenteeismRate')).not.toBeInTheDocument()
    expect(screen.getByText('statTotalHeadcount').closest('.stat')).toHaveTextContent('135')
    expect(screen.getByText('statAvgTenure').closest('.stat')).toHaveTextContent('8.4')
  })

  it('renders the monthly trend section as honestly not-yet-available (the KPI endpoint never returns monthlyTrend today)', async () => {
    mockLoaders({})
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('cardMonthlyTrend')).toBeInTheDocument()
    expect(screen.getByText('trendNotAvailable')).toBeInTheDocument()
  })

  it('suppresses the gender breakdown when the backend reports genderSuppressed (GAP-HR-WORKFORCE-ANALYTICS-06, applying published default)', async () => {
    mockLoaders({ kpisBody: mockKpisSuppressed })
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('genderSuppressedNote')).toBeInTheDocument()
    expect(screen.queryByText('genderFemaleLabel')).not.toBeInTheDocument()
    expect(screen.queryByText('genderMaleLabel')).not.toBeInTheDocument()
  })

  it('shows the real gender breakdown once the backend reports the group is at/above threshold', async () => {
    mockLoaders({ kpisBody: mockKpisOpen })
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('genderFemaleLabel')).toBeInTheDocument()
    expect(screen.getByText('genderMaleLabel')).toBeInTheDocument()
    expect(screen.queryByText('genderSuppressedNote')).not.toBeInTheDocument()
  })

  it('renders retirement forecast as a period/count table -- no officer names, no undefined React key warning (GAP-HR-WORKFORCE-ANALYTICS-03/08)', async () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockLoaders({})
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('cardRetirementForecast')).toBeInTheDocument()
    expect(screen.getByText('2026-10')).toBeInTheDocument()
    expect(screen.getByText('2027-03')).toBeInTheDocument()
    expect(screen.queryByText('colOfficerName')).not.toBeInTheDocument()
    const keyWarning = warnSpy.mock.calls.some((args) => String(args[0]).includes('key'))
    expect(keyWarning).toBe(false)
    warnSpy.mockRestore()
  })

  it('headcount error only affects the headcount stat card -- avg tenure and retirement are unaffected', async () => {
    mockLoaders({ headcount: { data: [], source: 'error' } })
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('statTotalHeadcount').closest('.stat')).toHaveTextContent('—')
    expect(screen.getByText('statAvgTenure').closest('.stat')).toHaveTextContent('8.4')
    expect(screen.getByText('2026-10')).toBeInTheDocument()
  })

  it('KPI error only affects tenure/trend/gender -- headcount and retirement are unaffected', async () => {
    mockLoaders({ kpis: { data: {}, source: 'error' } })
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText('statAvgTenure').closest('.stat')).toHaveTextContent('—')
    expect(screen.getByText('genderNoData')).toBeInTheDocument()
    expect(screen.getByText('statTotalHeadcount').closest('.stat')).toHaveTextContent('135')
    expect(screen.getByText('2026-10')).toBeInTheDocument()
  })

  it('retirement error: counts read — in a NEUTRAL colour, never the success green, and the table area shows a retry state (GAP-HR-WORKFORCE-ANALYTICS-02)', async () => {
    mockLoaders({ retirements: { data: [], source: 'error' } })
    render(await WorkforceAnalyticsPage())

    const soonValue = screen.getByText('retiringWithin6').previousSibling as HTMLElement;
    expect(soonValue).toHaveTextContent('—')
    // Read the raw `style` attribute string (not the jsdom-parsed CSSOM,
    // which may not round-trip a `var(...)` value) so this checks exactly
    // what React rendered, regardless of jsdom's CSS-value parsing.
    const rawStyle = soonValue.getAttribute('style') ?? ''
    expect(rawStyle).not.toContain('--good')
    expect(rawStyle).not.toContain('--bad')
    expect(rawStyle).toContain('--muted')

    expect(screen.queryByText('2026-10')).not.toBeInTheDocument()
    // headcount/kpis cards are unaffected by retirement's own failure.
    expect(screen.getByText('statTotalHeadcount').closest('.stat')).toHaveTextContent('135')
    expect(screen.getByText('statAvgTenure').closest('.stat')).toHaveTextContent('8.4')
  })

  it('a plain employee session sees PermissionDenied, not a broken-looking all-error page (GAP-HR-WORKFORCE-ANALYTICS-06)', async () => {
    getSessionRolesMock.mockReturnValue(['employee'])
    mockLoaders({})
    render(await WorkforceAnalyticsPage())
    expect(screen.getByText(/Access restricted/i)).toBeInTheDocument()
    expect(fetchJsonMock).not.toHaveBeenCalled()
  })

  it('generateMetadata builds its title through next-intl, not a hardcoded English literal (GAP-HR-WORKFORCE-ANALYTICS-07)', async () => {
    const meta = await generateMetadata()
    // Under the identity-mocked getTranslations, t('title') === 'title' --
    // proving the localizable part flows through t(), not a JS string
    // literal (the original bug: `metadata = { title: 'Workforce Analytics
    // — CivitasOne HRMS' }`, which no mock/locale could ever change).
    expect(meta.title).toBe('title — CivitasOne HRMS')
  })

  it('has no raw hex colour literal left in the page source (GAP-HR-WORKFORCE-ANALYTICS-05)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'page.tsx'), 'utf8')
    expect(source).not.toContain('#e040fb')
    // Every remaining hex in the file is a `var(--token, #fallback)` pair,
    // never a bare `background: '#hex'` / `background: "#hex"` literal.
    const bareHexAssignments = source.match(/(?:background|color|fill|stroke)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/g) ?? []
    expect(bareHexAssignments).toEqual([])
  })
})
