'use client'
import { useState, useRef, useCallback } from 'react'
import type { OrgChartNode } from '@civitasone/types'

function OrgNode({
  node,
  depth,
  search,
  expanded,
  onToggle,
}: {
  node: OrgChartNode
  depth: number
  search: string
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const term = search.toLowerCase()
  const match =
    term !== '' &&
    (node.name.toLowerCase().includes(term) ||
      node.designation.toLowerCase().includes(term) ||
      node.department.toLowerCase().includes(term))

  const hasChildren = Array.isArray(node.children) && node.children.length > 0
  const isExpanded = expanded.has(node.id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      {/* Connector line from parent */}
      {depth > 0 && (
        <div style={{ width: 2, height: 20, background: 'var(--border)', flexShrink: 0 }} aria-hidden="true" />
      )}

      {/* Node card */}
      <div
        onClick={() => hasChildren && onToggle(node.id)}
        style={{
          background: match ? 'var(--accent-bg, #fffbeb)' : 'var(--surface, #fff)',
          border: `2px solid ${match ? 'var(--accent, #f59e0b)' : 'var(--border, #e2e8f0)'}`,
          borderRadius: 8,
          padding: '8px 14px',
          minWidth: 130,
          maxWidth: 190,
          textAlign: 'center',
          cursor: hasChildren ? 'pointer' : 'default',
          boxShadow: match
            ? '0 0 0 3px rgba(245,158,11,0.2)'
            : '0 1px 4px rgba(0,0,0,0.07)',
          position: 'relative',
          userSelect: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        role={hasChildren ? 'button' : undefined}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-label={`${node.name}, ${node.designation}${hasChildren ? (isExpanded ? ', expanded' : ', collapsed') : ''}`}
        tabIndex={hasChildren ? 0 : undefined}
        onKeyDown={(e) => {
          if (hasChildren && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onToggle(node.id)
          }
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text, #1e293b)', lineHeight: 1.3 }}>
          {node.name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3, #64748b)', marginTop: 3, lineHeight: 1.3 }}>
          {node.designation}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3, #64748b)', marginTop: 1, fontStyle: 'italic' }}>
          {node.department}
        </div>
        {hasChildren && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              bottom: -12,
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: 12,
              color: 'var(--text-3, #64748b)',
              lineHeight: 1,
              zIndex: 1,
            }}
          >
            {isExpanded ? '▴' : '▾'}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 22,
            paddingTop: 0,
            position: 'relative',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {/* Horizontal connector bar */}
          {node.children!.length > 1 && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                height: 1,
                width: `calc(100% - 80px)`,
                background: 'var(--border, #e2e8f0)',
              }}
            />
          )}
          {node.children!.map((child) => (
            <OrgNode
              key={child.id}
              node={child}
              depth={depth + 1}
              search={search}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function collectIds(nodes: OrgChartNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (ns: OrgChartNode[]) =>
    ns.forEach((n) => {
      ids.add(n.id)
      if (n.children) walk(n.children)
    })
  walk(nodes)
  return ids
}

export function OrgChartClient({ data }: { data: OrgChartNode[] }) {
  const [zoom, setZoom] = useState(1)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => collectIds(data))
  const containerRef = useRef<HTMLDivElement>(null)

  const toggleNode = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAll = useCallback(() => setExpanded(collectIds(data)), [data])
  const collapseAll = useCallback(() => setExpanded(new Set()), [])

  const clampZoom = (z: number) => Math.min(Math.max(z, 0.3), 2.5)

  const btnStyle: React.CSSProperties = {
    padding: '6px 12px',
    border: '1px solid var(--border, #e2e8f0)',
    borderRadius: 6,
    background: 'var(--surface, #fff)',
    color: 'var(--text, #1e293b)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1,
    flexShrink: 0,
  }

  if (data.length === 0) {
    return <p style={{ textAlign: 'center', color: 'var(--text-3)' }}>No organisation chart data available.</p>
  }

  return (
    <div>
      {/* ── Controls bar ── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          type="search"
          placeholder="Search names, roles, or departments…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search org chart"
          style={{
            flex: 1,
            minWidth: 200,
            padding: '7px 12px',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 6,
            background: 'var(--surface, #fff)',
            color: 'var(--text, #1e293b)',
            fontSize: 13,
            outline: 'none',
          }}
        />

        {/* Zoom controls */}
        <button
          onClick={() => setZoom((z) => clampZoom(z - 0.15))}
          aria-label="Zoom out"
          title="Zoom out"
          style={btnStyle}
        >
          −
        </button>
        <button
          onClick={() => setZoom(1)}
          aria-label="Reset zoom"
          title="Reset zoom"
          style={{ ...btnStyle, minWidth: 48 }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => setZoom((z) => clampZoom(z + 0.15))}
          aria-label="Zoom in"
          title="Zoom in"
          style={btnStyle}
        >
          +
        </button>

        {/* Expand / collapse */}
        <button onClick={expandAll} style={btnStyle} title="Expand all nodes">
          Expand all
        </button>
        <button onClick={collapseAll} style={btnStyle} title="Collapse all nodes">
          Collapse all
        </button>
      </div>

      {/* ── Chart canvas ── */}
      <div
        ref={containerRef}
        style={{
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: '68vh',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 10,
          padding: 32,
          background: 'var(--bg, #f8fafc)',
        }}
        onWheel={(e) => {
          e.preventDefault()
          setZoom((z) => clampZoom(z - e.deltaY * 0.0008))
        }}
        aria-label="Organisation chart — use zoom controls or scroll to zoom"
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease',
            display: 'flex',
            gap: 32,
            justifyContent: 'center',
            flexWrap: 'wrap',
            padding: '8px 0',
          }}
        >
          {data.map((root) => (
            <OrgNode
              key={root.id}
              node={root}
              depth={0}
              search={search}
              expanded={expanded}
              onToggle={toggleNode}
            />
          ))}
        </div>
      </div>

      {/* ── Search hint ── */}
      {search !== '' && (
        <div
          role="status"
          aria-live="polite"
          style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3, #64748b)' }}
        >
          Highlighting matches for &ldquo;{search}&rdquo; — expand nodes to reveal hidden matches
        </div>
      )}
    </div>
  )
}
