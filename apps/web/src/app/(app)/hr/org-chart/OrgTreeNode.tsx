'use client'
import { useCallback, type KeyboardEvent } from 'react'
import { Avatar } from '@/app/_components/ds'
import type { OrgChartNode } from '@civitasone/types'

interface OrgTreeNodeProps {
  node: OrgChartNode
  depth: number
  search: string
  expanded: Set<string>
  onToggle: (id: string) => void
  onFocus?: (id: string) => void
  /**
   * Roving-tabindex state, owned by the tree root (OrgChartClient): the id
   * of the one treeitem in the whole tree that currently has tabIndex 0.
   * Defaults to this node's own id so OrgTreeNode still behaves correctly
   * (and renders as a standalone, always-tabbable node) when used outside
   * a tree root that manages roving focus.
   */
  activeId?: string
  /**
   * Ids of every currently VISIBLE treeitem, in document order, respecting
   * each ancestor's expand/collapse state. Used by ArrowUp/ArrowDown/Home/End
   * to find the navigation target. Owned by the tree root; defaults to an
   * empty array (arrow-key roving navigation is inert without it, but the
   * existing Enter/Space/ArrowRight/ArrowLeft expand/collapse behavior is
   * unaffected).
   */
  visibleOrder?: string[]
  /** Move roving focus to the treeitem with this id. */
  onNavigate?: (id: string) => void
  /** Registers/unregisters this node's DOM element with the tree root so
   * onNavigate can move real DOM focus to it. */
  registerRef?: (id: string, el: HTMLDivElement | null) => void
}

function DesignationChip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.3,
        padding: '2px 6px',
        borderRadius: 4,
        background: 'var(--chip-bg, #e6f0ff)',
        color: 'var(--chip-text, #00439C)',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={label}
    >
      {label}
    </span>
  )
}

export function OrgTreeNode({
  node,
  depth,
  search,
  expanded,
  onToggle,
  onFocus,
  activeId = node.id,
  visibleOrder = [],
  onNavigate,
  registerRef,
}: OrgTreeNodeProps) {
  const term = search.toLowerCase().trim()
  const match =
    term !== '' &&
    (node.name.toLowerCase().includes(term) ||
      node.designation.toLowerCase().includes(term) ||
      node.department.toLowerCase().includes(term))

  const hasChildren = Array.isArray(node.children) && node.children.length > 0
  const isExpanded = expanded.has(node.id)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (hasChildren) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(node.id)
          return
        } else if (e.key === 'ArrowRight' && !isExpanded) {
          e.preventDefault()
          onToggle(node.id)
          return
        } else if (e.key === 'ArrowLeft' && isExpanded) {
          e.preventDefault()
          onToggle(node.id)
          return
        }
      }
      // Roving-tabindex navigation (WAI-ARIA tree pattern): move focus to
      // the next/previous/first/last VISIBLE treeitem. This runs for every
      // node — leaf or branch — independent of the hasChildren block above,
      // and is a no-op unless the tree root wired up onNavigate/visibleOrder.
      if (!onNavigate || visibleOrder.length === 0) return
      const idx = visibleOrder.indexOf(node.id)
      if (idx === -1) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        onNavigate(visibleOrder[Math.min(idx + 1, visibleOrder.length - 1)] ?? node.id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        onNavigate(visibleOrder[Math.max(idx - 1, 0)] ?? node.id)
      } else if (e.key === 'Home') {
        e.preventDefault()
        onNavigate(visibleOrder[0] ?? node.id)
      } else if (e.key === 'End') {
        e.preventDefault()
        onNavigate(visibleOrder[visibleOrder.length - 1] ?? node.id)
      }
    },
    [hasChildren, isExpanded, node.id, onToggle, visibleOrder, onNavigate],
  )

  const avatarColors = ['#00439C', '#1a6d3c', '#7c2d12', '#4c1d95', '#064e3b', '#831843']
  const avatarColor = avatarColors[(node.name.charCodeAt(0) ?? 0) % avatarColors.length]

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}
      data-testid={`org-node-${node.id}`}
    >
      {depth > 0 && (
        <div
          style={{ width: 2, height: 24, background: 'var(--border, #e2e8f0)', flexShrink: 0 }}
          aria-hidden="true"
        />
      )}

      {/* Node card */}
      <div
        ref={(el) => registerRef?.(node.id, el)}
        role="treeitem"
        aria-selected={false}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-label={`${node.name}, ${node.designation}, ${node.department}${
          hasChildren ? (isExpanded ? ', collapse' : ', expand') : ''
        }`}
        tabIndex={activeId === node.id ? 0 : -1}
        onClick={() => hasChildren && onToggle(node.id)}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocus?.(node.id)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          background: match ? '#fffbeb' : 'var(--surface, #fff)',
          border: `2px solid ${match ? '#f59e0b' : depth === 0 ? '#00439C' : 'var(--border, #e2e8f0)'}`,
          borderRadius: 8,
          padding: '10px 16px',
          minWidth: 140,
          maxWidth: 200,
          textAlign: 'center',
          cursor: hasChildren ? 'pointer' : 'default',
          boxShadow: match
            ? '0 0 0 3px rgba(245,158,11,0.25)'
            : depth === 0
            ? '0 2px 8px rgba(0,67,156,0.15)'
            : '0 1px 4px rgba(0,0,0,0.07)',
          userSelect: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          minHeight: 44, // WCAG touch target
          position: 'relative',
        }}
      >
        <Avatar name={node.name} color={avatarColor} size="sm" />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg, #0f172a)', lineHeight: 1.3, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </div>
        <DesignationChip label={node.designation} />
        {hasChildren && (
          <div
            aria-hidden="true"
            style={{
              fontSize: 10,
              color: 'var(--muted, #64748b)',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              lineHeight: 1,
              marginTop: 2,
            }}
          >
            ▼
          </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          <div
            style={{ width: 2, height: 20, background: 'var(--border, #e2e8f0)' }}
            aria-hidden="true"
          />
          {/* Horizontal connector for multiple children */}
          {(node.children ?? []).length > 1 ? (
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  gap: 16,
                  alignItems: 'flex-start',
                  position: 'relative',
                }}
              >
                {(node.children as OrgChartNode[]).map((child, idx, arr) => (
                  <OrgTreeNode
                    key={child.id}
                    node={child}
                    depth={depth + 1}
                    search={search}
                    expanded={expanded}
                    onToggle={onToggle}
                    onFocus={onFocus}
                    activeId={activeId}
                    visibleOrder={visibleOrder}
                    onNavigate={onNavigate}
                    registerRef={registerRef}
                  />
                ))}
              </div>
            </div>
          ) : (
            (node.children as OrgChartNode[]).map((child) => (
              <OrgTreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                search={search}
                expanded={expanded}
                onToggle={onToggle}
                onFocus={onFocus}
                activeId={activeId}
                visibleOrder={visibleOrder}
                onNavigate={onNavigate}
                registerRef={registerRef}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
