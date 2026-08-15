import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const fetchJsonMock = vi.fn()
vi.mock('@/app/_data/apiClient', () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}))
vi.mock('../../../../_components/DataSourceBadge', () => ({
  DataSourceBadge: () => null,
}))
vi.mock('../../../../_components/ds', () => ({
  PageHeader: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  ),
  StatGrid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StatCard: ({ label, value }: { label: string; value: string | number }) => (
    <div data-testid={`stat-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <span>{label}</span>
      <span data-testid={`stat-val-${label.replace(/\s+/g, '-').toLowerCase()}`}>{value}</span>
    </div>
  ),
  Card: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {children}
    </div>
  ),
  DataTable: ({ rows }: { rows: unknown[] }) => <div data-testid="data-table">rows:{rows.length}</div>,
}))

import WorkSummaryPage from './page'

const mockRows = [
  { id: 'ws-1', employee: 'Amit Sharma', department: 'Finance', period: '2025-26', periodType: 'Annual', tasksCompleted: 18, totalTasks: 20, rating: 4.2, status: 'approved' },
  { id: 'ws-2', employee: 'Deepa Nair', department: 'HR', period: '2025-26', periodType: 'Annual', tasksCompleted: 15, totalTasks: 15, rating: 4.8, status: 'pending' },
  { id: 'ws-3', employee: 'Vijay Kumar', department: 'IT', period: '2024-25', periodType: 'Annual', tasksCompleted: 10, totalTasks: 12, rating: 3.9, status: 'submitted' },
]

describe('WorkSummaryPage', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
    fetchJsonMock.mockResolvedValue({ data: mockRows, source: 'api' })
  })

  it('renders page title', async () => {
    render(await WorkSummaryPage())
    expect(screen.getByText('Work Summaries')).toBeInTheDocument()
  })

  it('renders stat cards', async () => {
    render(await WorkSummaryPage())
    expect(screen.getByText('Total Records')).toBeInTheDocument()
    expect(screen.getByText('Employees')).toBeInTheDocument()
    expect(screen.getByText('Reviewed')).toBeInTheDocument()
    expect(screen.getByText('Pending Review')).toBeInTheDocument()
  })

  it('calculates correct stat values', async () => {
    render(await WorkSummaryPage())
    // Use data-testid from the mocked StatCard to be precise
    const totalRecords = screen.getByTestId('stat-val-total-records')
    expect(totalRecords).toHaveTextContent('3')
    const reviewed = screen.getByTestId('stat-val-reviewed')
    expect(reviewed).toHaveTextContent('1') // only 'approved' counts
    const pending = screen.getByTestId('stat-val-pending-review')
    expect(pending).toHaveTextContent('2') // pending + submitted
  })

  it('renders data table', async () => {
    render(await WorkSummaryPage())
    expect(screen.getByTestId('data-table')).toBeInTheDocument()
    expect(screen.getByText('rows:3')).toBeInTheDocument()
  })

  it('renders DoPT reference note', async () => {
    render(await WorkSummaryPage())
    expect(screen.getByText(/DoPT O\.M\. No\./)).toBeInTheDocument()
  })
})
