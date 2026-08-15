import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const fetchJsonMock = vi.fn()
vi.mock('@/app/_data/apiClient', () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}))
vi.mock('../../../../_components/DataSourceBadge', () => ({
  DataSourceBadge: () => null,
}))

import StaffingPlanPage from './page'

// These rows are pre-mapped (as the page receives them from fetchJson mock).
// vacancyAlert is set here because mapResponse is bypassed by the mock.
const mockRows = [
  { id: 'sp-1', department: 'Finance Division', cadre: 'IFS', sanctionedPosts: 20, filled: 15, vacant: 5, fillPercentage: 75, lastReview: '2025-04-01', status: 'active', vacancyAlert: false },
  { id: 'sp-2', department: 'IT Department', cadre: 'CSS', sanctionedPosts: 50, filled: 40, vacant: 10, fillPercentage: 80, lastReview: '2025-03-15', status: 'active', vacancyAlert: false },
  { id: 'sp-3', department: 'HR Wing', cadre: 'CSSS', sanctionedPosts: 30, filled: 20, vacant: 10, fillPercentage: 67, lastReview: '2025-02-01', status: 'active', vacancyAlert: false },
]

// High-vacancy data: must include vacancyAlert:true since mapRow is bypassed
const highVacancyRows = [
  { id: 'sp-1', department: 'Legal Cell', cadre: '—', sanctionedPosts: 10, filled: 8, vacant: 2, fillPercentage: 80, lastReview: '—', status: 'active', vacancyAlert: false },
  { id: 'sp-2', department: 'Policy Wing', cadre: '—', sanctionedPosts: 10, filled: 5, vacant: 5, fillPercentage: 50, lastReview: '—', status: 'active', vacancyAlert: true },
]

describe('StaffingPlanPage', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
  })

  it('renders page title', async () => {
    fetchJsonMock.mockResolvedValue({ data: mockRows, source: 'api' })
    render(await StaffingPlanPage())
    expect(screen.getByText('Staffing Plan')).toBeInTheDocument()
  })

  it('renders stat cards with correct totals', async () => {
    fetchJsonMock.mockResolvedValue({ data: mockRows, source: 'api' })
    render(await StaffingPlanPage())
    expect(screen.getByText('Sanctioned Posts')).toBeInTheDocument()
    expect(screen.getByText('Filled Positions')).toBeInTheDocument()
    expect(screen.getByText('Vacant Posts')).toBeInTheDocument()
    expect(screen.getByText('Fill Rate %')).toBeInTheDocument()
    // total sanctioned = 20+50+30 = 100
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('renders department rows', async () => {
    fetchJsonMock.mockResolvedValue({ data: mockRows, source: 'api' })
    render(await StaffingPlanPage())
    expect(screen.getByText('Finance Division')).toBeInTheDocument()
    expect(screen.getByText('IT Department')).toBeInTheDocument()
  })

  it('shows vacancy alert when vacancyAlert=true in data', async () => {
    fetchJsonMock.mockResolvedValue({ data: highVacancyRows, source: 'api' })
    render(await StaffingPlanPage())
    // 1 department has vacancyAlert:true → alert is rendered
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('Vacancy Alert')
  })

  it('renders GFR note at bottom', async () => {
    fetchJsonMock.mockResolvedValue({ data: mockRows, source: 'api' })
    render(await StaffingPlanPage())
    // GFR note appears in footer paragraph
    const notes = screen.getAllByText(/GFR 2017 Rule 228/)
    expect(notes.length).toBeGreaterThanOrEqual(1)
  })
})
