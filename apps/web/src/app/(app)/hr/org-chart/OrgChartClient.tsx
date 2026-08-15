'use client'
import { useState, useCallback, useRef } from 'react'
import type { OrgChartNode } from '@civitasone/types'
import { OrgTreeNode } from './OrgTreeNode'

function collectAllIds(nodes: OrgChartNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectAllIds((n.children ?? []) as OrgChartNode[])])
}

export function OrgChartClient({ data }: { data: OrgChartNode[] }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(data.map((n) => n.id)),
  )
  const searchRef = useRef<HTMLInputElement>(null)

  const onToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    setExpanded(new Set(collectAllIds(data)))
  }, [data])

  const collapseAll = useCallback(() => {
    setExpanded(new Set())
  }, [])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  const roots = data.filter((n) => !n.reportsTo)

  return (
    <div>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
        role="toolbar"
        aria-label="Org chart controls"
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 200px' }}>
          <span className="sr-only">Search employees</span>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search by name or designation…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search org chart by name, designation or department"
            style={{
              border: '1.5px solid var(--border, #e2e8f0)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
              outline: 'none',
              width: '100%',
              minHeight: 44,
            }}
          />
        </label>
        <button
          onClick={expandAll}
          style={toolbarBtn}
          aria-label="Expand all nodes"
        >
          ⊞ Expand all
        </button>
        <button
          onClick={collapseAll}
          style={toolbarBtn}
          aria-label="Collapse all nodes"
        >
          ⊟ Collapse all
        </button>
        <button
          onClick={handlePrint}
          style={{ ...toolbarBtn, background: '#00439C', color: '#fff', borderColor: '#00439C' }}
          aria-label="Print or export org chart as PDF"
        >
          🖨 Print / PDF
        </button>
      </div>

      {/* Tree */}
      <div
        role="tree"
        aria-label="Organisation hierarchy"
        style={{
          overflowX: 'auto',
          padding: '8px 0 16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0,
            minWidth: 'max-content',
            margin: '0 auto',
          }}
        >
          {roots.length > 0 ? (
            roots.map((root) => (
              <OrgTreeNode
                key={root.id}
                node={root}
                depth={0}
                search={search}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))
          ) : (
            <p style={{ color: 'var(--muted, #64748b)', fontSize: 14 }}>
              No organisational hierarchy data available.
            </p>
          )}
        </div>
      </div>

      {/* GFR note */}
      <p
        style={{
          fontSize: 11,
          color: 'var(--muted, #64748b)',
          borderTop: '1px solid var(--border, #e2e8f0)',
          paddingTop: 8,
          marginTop: 8,
        }}
      >
        Reporting structure reflects sanctioned posts per service records. Vacant
        positions are shown as pending assignment.
      </p>
    </div>
  )
}

const toolbarBtn: React.CSSProperties = {
  border: '1.5px solid var(--border, #e2e8f0)',
  borderRadius: 6,
  background: 'var(--surface, #fff)',
  color: 'var(--fg, #0f172a)',
  fontSize: 12,
  fontWeight: 600,
  padding: '8px 12px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  minHeight: 44,
}
