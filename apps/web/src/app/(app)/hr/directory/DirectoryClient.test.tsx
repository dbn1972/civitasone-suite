import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '@/messages/en.json'
import { DirectoryClient } from './DirectoryClient'

const replaceMock = vi.fn()
let searchParamsValue = ''

// GAP-HR-DIRECTORY-03: search is now server-driven (router.replace with a
// `q` URL param) instead of a client-side .filter() over the loaded array --
// mock next/navigation the same way this repo's other client-form tests do
// (see RegisterDeviceForm.test.tsx), plus useSearchParams/usePathname which
// this component also reads.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/hr/directory',
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>)
}

const employees = Array.from({ length: 45 }, (_, i) => ({
  id: `emp-${i}`,
  name: `Employee ${i}`,
  department: i % 3 === 0 ? 'Finance' : i % 3 === 1 ? 'HR' : 'IT',
  designation: i % 2 === 0 ? 'Section Officer' : 'Under Secretary',
  grade: `Grade-${(i % 3) + 1}`,
  email: `emp${i}@gov.in`,
}))

describe('DirectoryClient', () => {
  beforeEach(() => {
    replaceMock.mockClear()
    searchParamsValue = ''
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  it('renders first page of employees in card grid (20/page)', () => {
    render(<DirectoryClient employees={employees} initialQuery="" canViewProfiles={false} />)
    const cards = screen.getAllByRole('button', { name: /View details for Employee/ })
    expect(cards.length).toBe(20)
  })

  it('shows total employee count', () => {
    render(<DirectoryClient employees={employees} initialQuery="" canViewProfiles={false} />)
    expect(screen.getByText(/45 employees/)).toBeInTheDocument()
  })

  it('debounces a search keystroke into a router.replace with ?q=', () => {
    render(<DirectoryClient employees={employees} initialQuery="" canViewProfiles={false} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'sharma' } })
    expect(replaceMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(350)
    expect(replaceMock).toHaveBeenCalledWith('/hr/directory?q=sharma')
  })

  it('clears the q param when the search box is emptied', () => {
    searchParamsValue = 'q=sharma'
    render(<DirectoryClient employees={employees} initialQuery="sharma" canViewProfiles={false} />)
    const input = screen.getByRole('searchbox')
    expect(input).toHaveValue('sharma')
    fireEvent.change(input, { target: { value: '' } })
    vi.advanceTimersByTime(350)
    expect(replaceMock).toHaveBeenCalledWith('/hr/directory?')
  })

  it('paginates the loaded page client-side — next page shows different employees', () => {
    render(<DirectoryClient employees={employees} initialQuery="" canViewProfiles={false} />)
    const nextBtn = screen.getByRole('button', { name: 'Next page' })
    fireEvent.click(nextBtn)
    expect(screen.getByText(/Page 2 of/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Employee 20/ })).toBeInTheDocument()
  })

  it('shows prev button disabled on first page', () => {
    render(<DirectoryClient employees={employees} initialQuery="" canViewProfiles={false} />)
    const prevBtn = screen.getByRole('button', { name: 'Previous page' })
    expect(prevBtn).toBeDisabled()
  })

  it('switches to table view', () => {
    render(<DirectoryClient employees={employees} initialQuery="" canViewProfiles={false} />)
    const tableBtn = screen.getByRole('button', { name: 'Table' })
    fireEvent.click(tableBtn)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('opens employee detail modal on card click, without a profile link by default', () => {
    render(<DirectoryClient employees={employees.slice(0, 5)} initialQuery="" canViewProfiles={false} />)
    const card = screen.getByRole('button', { name: /Employee 0/ })
    fireEvent.click(card)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('emp0@gov.in')).toBeInTheDocument()
    expect(screen.queryByText('View full profile')).not.toBeInTheDocument()
    expect(screen.getByText('View in org chart')).toBeInTheDocument()
  })

  it('shows a profile link in the modal when canViewProfiles is true', () => {
    render(<DirectoryClient employees={employees.slice(0, 5)} initialQuery="" canViewProfiles={true} />)
    fireEvent.click(screen.getByRole('button', { name: /Employee 0/ }))
    expect(screen.getByRole('link', { name: 'View full profile' })).toHaveAttribute('href', '/hr/employees/emp-0')
  })

  it('closes detail modal on close button', () => {
    render(<DirectoryClient employees={employees.slice(0, 5)} initialQuery="" canViewProfiles={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Employee 0/ }))
    const closeBtn = screen.getByRole('button', { name: 'Close employee details' })
    fireEvent.click(closeBtn)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows empty state when the server returns no rows for the current search', () => {
    render(<DirectoryClient employees={[]} initialQuery="xyznotexist" canViewProfiles={false} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No employees found')).toBeInTheDocument()
  })

  // GAP-HR-DIRECTORY-02: a row with no resolvable designation must not
  // announce the literal string "undefined" to a screen reader.
  it('omits the designation from the accessible name when absent', () => {
    const noDesignation = [{ id: 'emp-x', name: 'Asha Rao', department: 'Finance' }]
    render(<DirectoryClient employees={noDesignation} initialQuery="" canViewProfiles={false} />)
    expect(screen.getByRole('button', { name: 'View details for Asha Rao' })).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })
})
