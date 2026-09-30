import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// RefreshErrorState (rendered on the GAP-HR-ORG-CHART-03 error path) uses
// next/navigation's useRouter internally -- mocked the same way
// RefreshErrorState.test.tsx does, so it renders outside a real Next.js
// router context.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../../../_data/loaders', () => ({
  getOrgChart: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'root-1',
        name: 'Amit Singh',
        designation: 'Secretary',
        department: 'Ministry of Finance',
        reportsTo: null,
        children: [
          {
            id: 'div-1',
            name: 'Priya Sharma',
            designation: 'Joint Secretary',
            department: 'Revenue Division',
            reportsTo: 'root-1',
            children: [],
          },
        ],
      },
    ],
    source: 'api',
  }),
}))

vi.mock('./OrgChartClient', () => ({
  OrgChartClient: ({ data }: { data: unknown[] }) => (
    <div data-testid="org-chart-client">nodes:{data.length}</div>
  ),
}))

import { getOrgChart } from '../../../_data/loaders'
import OrgChartPage from './page'

describe('OrgChartPage', () => {
  it('renders page title', async () => {
    render(await OrgChartPage())
    expect(screen.getByText('Organisation Chart')).toBeInTheDocument()
  })

  it('renders stat cards', async () => {
    render(await OrgChartPage())
    expect(screen.getByText('Total Employees')).toBeInTheDocument()
    expect(screen.getByText('Departments')).toBeInTheDocument()
    expect(screen.getByText('Managers')).toBeInTheDocument()
  })

  it('renders org chart client with data', async () => {
    render(await OrgChartPage())
    expect(screen.getByTestId('org-chart-client')).toBeInTheDocument()
  })

  // GAP-HR-ORG-CHART-02: managers/departments/roots must be computed over
  // the WHOLE tree, not just the top-level `nodes` array. A(B(C), D) --
  // A and B each have children (managers=2), total=4 employees, roots=1
  // (only A is top-level), and departments are deliberately different at
  // every depth so a top-level-only count (the pre-fix bug) would wrongly
  // report 1 instead of 3.
  it('computes managers/departments/total across the full tree, not just top-level nodes', async () => {
    vi.mocked(getOrgChart).mockResolvedValueOnce({
      data: [
        {
          id: 'a', name: 'A', designation: 'Secretary', department: 'Finance', reportsTo: null,
          children: [
            {
              id: 'b', name: 'B', designation: 'Joint Secretary', department: 'Revenue', reportsTo: 'a',
              children: [
                { id: 'c', name: 'C', designation: 'Officer', department: 'Audit', reportsTo: 'b', children: [] },
              ],
            },
            { id: 'd', name: 'D', designation: 'Officer', department: 'Finance', reportsTo: 'a', children: [] },
          ],
        },
      ],
      source: 'api',
    })

    render(await OrgChartPage())

    expect(screen.getByTestId('org-chart-client')).toHaveTextContent('nodes:1')
    expect(screen.getByText('4')).toBeInTheDocument() // total employees: A, B, C, D
    expect(screen.getByText('2')).toBeInTheDocument() // managers: A and B
    expect(screen.getByText('3')).toBeInTheDocument() // departments: Finance, Revenue, Audit
    expect(screen.getByText('1')).toBeInTheDocument() // roots: only A is top-level
  })

  // GAP-HR-ORG-CHART-03: a backend error must read as an honest error state
  // with "—" stats -- never a fabricated 0, and never the plain "no
  // hierarchy data" empty text (that's reserved for a genuinely empty API
  // response, not a failed fetch).
  it('shows an honest error state and "—" stats on a backend failure, never the empty-hierarchy message', async () => {
    vi.mocked(getOrgChart).mockResolvedValueOnce({ data: [], source: 'error' })

    render(await OrgChartPage())

    expect(screen.queryByText('No organisational hierarchy data available.')).not.toBeInTheDocument()
    expect(screen.queryByTestId('org-chart-client')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
  })
})
