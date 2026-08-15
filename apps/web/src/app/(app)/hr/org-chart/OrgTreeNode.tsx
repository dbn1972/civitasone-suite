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

export function OrgTreeNode({ node, depth, search, expanded, onToggle, onFocus }: OrgTreeNodeProps) {
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
      if (!hasChildren) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onToggle(node.id)
      } else if (e.key === 'ArrowRight' && !isExpanded) {
        e.preventDefault()
        onToggle(node.id)
      } else if (e.key === 'ArrowLeft' && isExpanded) {
        e.preventDefault()
        onToggle(node.id)
      }
    },
    [hasChildren, isExpanded, node.id, onToggle],
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
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-label={`${node.name}, ${node.designation}, ${node.department}${
          hasChildren ? (isExpanded ? ', collapse' : ', expand') : ''
        }`}
        tabIndex={0}
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
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
