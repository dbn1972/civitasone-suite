import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
})
