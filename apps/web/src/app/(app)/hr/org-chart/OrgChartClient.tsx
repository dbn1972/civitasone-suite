'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OrgChartNode } from '@civitasone/types'
import { OrgTreeNode } from './OrgTreeNode'
import { Button } from '@/app/_components/ds'

function collectAllIds(nodes: OrgChartNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectAllIds((n.children ?? []) as OrgChartNode[])])
}

/**
 * Flattens the tree into the ids of every currently VISIBLE treeitem, in
 * document order — a node's children only contribute if that node is both
 * expanded AND itself present in `nodes` (i.e. we never descend past a
 * collapsed ancestor). Backs ArrowUp/ArrowDown/Home/End roving navigation.
 */
function flattenVisible(nodes: OrgChartNode[], expanded: Set<string>): string[] {
  const out: string[] = []
  for (const n of nodes) {
    out.push(n.id)
    if (expanded.has(n.id) && n.children && n.children.length > 0) {
      out.push(...flattenVisible(n.children as OrgChartNode[], expanded))
    }
  }
  return out
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

  const roots = useMemo(() => data.filter((n) => !n.reportsTo), [data])

  // Roving tabindex (WAI-ARIA tree pattern): exactly one treeitem in the
  // whole tree — `activeId` — has tabIndex 0 at a time; everything else is
  // -1 but still reachable via ArrowUp/ArrowDown/Home/End. `visibleOrder`
  // is the navigation order those keys walk; `nodeRefs` lets onNavigate
  // move real DOM focus (arrow keys don't do that natively).
  const visibleOrder = useMemo(() => flattenVisible(roots, expanded), [roots, expanded])
  const [activeId, setActiveId] = useState<string | null>(() => visibleOrder[0] ?? null)
  const nodeRefs = useRef(new Map<string, HTMLDivElement>())

  const registerNodeRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(id, el)
    else nodeRefs.current.delete(id)
  }, [])

  const onNavigate = useCallback((id: string) => {
    // Moving DOM focus fires that node's own onFocus handler, which is what
    // actually updates `activeId` (see onFocus={setActiveId} below) — one
    // code path keeps roving tabindex correct whether focus arrives via
    // mouse, Tab, or this programmatic call.
    nodeRefs.current.get(id)?.focus()
  }, [])

  useEffect(() => {
    // If the previously-active node scrolled out of the visible set (e.g. a
    // collapse elsewhere hid its whole branch), fall back to the first
    // visible node so the tree never ends up with zero tabbable treeitems.
    setActiveId((prev) => (prev !== null && visibleOrder.includes(prev) ? prev : (visibleOrder[0] ?? null)))
  }, [visibleOrder])

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
        <Button variant="ghost" onClick={expandAll} aria-label="Expand all nodes">
          ⊞ Expand all
        </Button>
        <Button variant="ghost" onClick={collapseAll} aria-label="Collapse all nodes">
          ⊟ Collapse all
        </Button>
        <Button onClick={handlePrint} aria-label="Print or export org chart as PDF">
          🖨 Print / PDF
        </Button>
      </div>

      {/* Tree.
          aria-required-children: role="tree"'s required owned elements are
          group/treeitem, checked transitively -- an empty role="group" with
          no treeitem descendants still leaves the requirement unmet (axe
          reports it against the outer tree either way). The earlier fix
          added role="group" unconditionally, which didn't clear the empty
          case. The structurally correct fix: only claim role="tree" (and
          its group wrapper) when there is at least one real treeitem to
          hold it; the empty state is plain informational text, not an
          empty tree widget. UX-005 tranche 5. */}
      {roots.length > 0 ? (
        <div
          role="tree"
          aria-label="Organisation hierarchy"
          style={{
            overflowX: 'auto',
            padding: '8px 0 16px',
          }}
        >
          <div
            role="group"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0,
              minWidth: 'max-content',
              margin: '0 auto',
            }}
          >
            {roots.map((root) => (
              <OrgTreeNode
                key={root.id}
                node={root}
                depth={0}
                search={search}
                expanded={expanded}
                onToggle={onToggle}
                onFocus={setActiveId}
                activeId={activeId ?? undefined}
                visibleOrder={visibleOrder}
                onNavigate={onNavigate}
                registerRef={registerNodeRef}
              />
            ))}
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--muted, #64748b)', fontSize: 14 }}>
          No organisational hierarchy data available.
        </p>
      )}

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
