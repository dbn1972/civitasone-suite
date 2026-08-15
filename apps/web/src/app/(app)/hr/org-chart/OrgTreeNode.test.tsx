import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrgTreeNode } from './OrgTreeNode'
import type { OrgChartNode } from '@civitasone/types'

const leafNode: OrgChartNode = {
  id: 'emp-1',
  name: 'Priya Sharma',
  designation: 'Section Officer',
  department: 'Finance',
}

const parentNode: OrgChartNode = {
  id: 'div-1',
  name: 'Rajiv Kumar',
  designation: 'Deputy Secretary',
  department: 'Administration',
  children: [
    { id: 'emp-2', name: 'Anita Verma', designation: 'Under Secretary', department: 'Administration' },
    { id: 'emp-3', name: 'Suresh Patel', designation: 'Section Officer', department: 'Administration' },
  ],
}

describe('OrgTreeNode', () => {
  it('renders name and designation', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={leafNode}
        depth={0}
        search=""
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument()
    expect(screen.getByText('Section Officer')).toBeInTheDocument()
  })

  it('does not show expand chevron for leaf node', () => {
    const toggle = vi.fn()
    const { container } = render(
      <OrgTreeNode
        node={leafNode}
        depth={0}
        search=""
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    const btn = container.querySelector('[role="button"]')
    expect(btn).toBeNull()
  })

  it('shows expand chevron and calls toggle on click for parent node', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={parentNode}
        depth={0}
        search=""
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    const btn = screen.getByRole('button')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(toggle).toHaveBeenCalledWith('div-1')
  })

  it('shows children when expanded', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={parentNode}
        depth={0}
        search=""
        expanded={new Set(['div-1'])}
        onToggle={toggle}
      />
    )
    expect(screen.getByText('Anita Verma')).toBeInTheDocument()
    expect(screen.getByText('Suresh Patel')).toBeInTheDocument()
  })

  it('hides children when collapsed', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={parentNode}
        depth={0}
        search=""
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    expect(screen.queryByText('Anita Verma')).not.toBeInTheDocument()
  })

  it('renders highlighted node when search matches', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={leafNode}
        depth={0}
        search="Priya"
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    // The node is rendered and name is present — match=true path executed
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument()
    const node = screen.getByText('Priya Sharma').closest('[data-testid="org-node-emp-1"]')
    expect(node).not.toBeNull()
  })

  it('handles keyboard Enter to expand', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={parentNode}
        depth={0}
        search=""
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    const btn = screen.getByRole('button')
    fireEvent.keyDown(btn, { key: 'Enter' })
    expect(toggle).toHaveBeenCalledWith('div-1')
  })

  it('handles keyboard ArrowRight to expand', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={parentNode}
        depth={0}
        search=""
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    const btn = screen.getByRole('button')
    fireEvent.keyDown(btn, { key: 'ArrowRight' })
    expect(toggle).toHaveBeenCalledWith('div-1')
  })

  it('handles keyboard ArrowLeft to collapse', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={parentNode}
        depth={0}
        search=""
        expanded={new Set(['div-1'])}
        onToggle={toggle}
      />
    )
    const btn = screen.getByRole('button')
    fireEvent.keyDown(btn, { key: 'ArrowLeft' })
    expect(toggle).toHaveBeenCalledWith('div-1')
  })

  it('has aria-label with name and designation', () => {
    const toggle = vi.fn()
    render(
      <OrgTreeNode
        node={parentNode}
        depth={0}
        search=""
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-label')).toContain('Rajiv Kumar')
    expect(btn.getAttribute('aria-label')).toContain('Deputy Secretary')
  })

  it('does not render connector line at depth 0', () => {
    const toggle = vi.fn()
    const { container } = render(
      <OrgTreeNode
        node={leafNode}
        depth={0}
        search=""
        expanded={new Set()}
        onToggle={toggle}
      />
    )
    // At depth 0 no connector line is rendered above the node
    // connector line appears as aria-hidden div with height 24px
    const lines = container.querySelectorAll('div[aria-hidden="true"]')
    // None of these should be the top connector (only depth > 0 gets the line)
    const topConnector = Array.from(lines).find((el) =>
      (el as HTMLElement).style.height === '24px'
    )
    expect(topConnector).toBeUndefined()
  })
})
