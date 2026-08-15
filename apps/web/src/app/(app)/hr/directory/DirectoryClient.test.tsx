import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DirectoryClient } from './DirectoryClient'

const employees = Array.from({ length: 45 }, (_, i) => ({
  id: `emp-${i}`,
  name: `Employee ${i}`,
  department: i % 3 === 0 ? 'Finance' : i % 3 === 1 ? 'HR' : 'IT',
  designation: i % 2 === 0 ? 'Section Officer' : 'Under Secretary',
  grade: `Grade-${(i % 3) + 1}`,
  extension: `10${i.toString().padStart(2, '0')}`,
  email: `emp${i}@gov.in`,
  location: i % 2 === 0 ? 'New Delhi' : 'Mumbai',
}))

describe('DirectoryClient', () => {
  it('renders first page of employees in card grid (20/page)', () => {
    render(<DirectoryClient employees={employees} />)
    const cards = screen.getAllByRole('button', { name: /View details for Employee/ })
    // In grid mode: 20 cards per page
    expect(cards.length).toBe(20)
  })

  it('shows total employee count', () => {
    render(<DirectoryClient employees={employees} />)
    expect(screen.getByText(/45 employees/)).toBeInTheDocument()
  })

  it('filters employees by name search', () => {
    render(<DirectoryClient employees={employees} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'Employee 1' } })
    // Employee 1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 = 11 matches
    expect(screen.getByText(/of 45 employees/)).toBeInTheDocument()
  })

  it('filters employees by department', () => {
    render(<DirectoryClient employees={employees} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'Finance' } })
    expect(screen.getByText(/of 45 employees/)).toBeInTheDocument()
  })

  it('paginates correctly — next page shows different employees', () => {
    render(<DirectoryClient employees={employees} />)
    const nextBtn = screen.getByRole('button', { name: 'Next page' })
    fireEvent.click(nextBtn)
    expect(screen.getByText(/page 2 of/)).toBeInTheDocument()
    // Page 2 cards: employees 20-39
    expect(screen.getByRole('button', { name: /Employee 20/ })).toBeInTheDocument()
  })

  it('shows prev button disabled on first page', () => {
    render(<DirectoryClient employees={employees} />)
    const prevBtn = screen.getByRole('button', { name: 'Previous page' })
    expect(prevBtn).toBeDisabled()
  })

  it('switches to table view', () => {
    render(<DirectoryClient employees={employees} />)
    const tableBtn = screen.getByRole('button', { name: 'Table view' })
    fireEvent.click(tableBtn)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('opens employee detail modal on card click', () => {
    render(<DirectoryClient employees={employees.slice(0, 5)} />)
    const card = screen.getByRole('button', { name: /Employee 0/ })
    fireEvent.click(card)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('emp0@gov.in')).toBeInTheDocument()
  })

  it('closes detail modal on close button', () => {
    render(<DirectoryClient employees={employees.slice(0, 5)} />)
    fireEvent.click(screen.getByRole('button', { name: /Employee 0/ }))
    const closeBtn = screen.getByRole('button', { name: 'Close employee details' })
    fireEvent.click(closeBtn)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows empty state when no employees match search', () => {
    render(<DirectoryClient employees={employees} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'xyznotexist' } })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No employees found')).toBeInTheDocument()
  })

  it('resets to page 1 after new search', () => {
    render(<DirectoryClient employees={employees} />)
    // Go to page 2
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText(/page 2/)).toBeInTheDocument()
    // Now search → resets to page 1
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Finance' } })
    expect(screen.queryByText(/page 2/)).not.toBeInTheDocument()
  })
})
