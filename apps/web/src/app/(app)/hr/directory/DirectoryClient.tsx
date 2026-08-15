'use client'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Avatar } from '@/app/_components/ds'

type Employee = {
  id: string
  name: string
  department: string
  designation: string
  grade?: string
  extension?: string
  email?: string
  location?: string
} & Record<string, unknown>

interface DirectoryClientProps {
  employees: Employee[]
}

const PAGE_SIZE = 20
const ASHOKA_BLUE = '#00439C'

function EmployeeCard({ emp, onClick }: { emp: Employee; onClick: (id: string) => void }) {
  const avatarColors = [ASHOKA_BLUE, '#1a6d3c', '#7c2d12', '#4c1d95', '#064e3b', '#831843', '#92400e']
  const color = avatarColors[(emp.name.charCodeAt(0) ?? 0) % avatarColors.length]

  return (
    <article
      onClick={() => onClick(emp.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick(emp.id)}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${emp.name}, ${emp.designation}`}
      style={{
        background: 'var(--surface, #fff)',
        border: '1.5px solid var(--border, #e2e8f0)',
        borderRadius: 10,
        padding: 16,
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 44,
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.borderColor = ASHOKA_BLUE
        ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,67,156,0.12)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border, #e2e8f0)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={emp.name} color={color} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: 'var(--fg, #0f172a)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {emp.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: ASHOKA_BLUE,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {emp.designation}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted, #64748b)', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {emp.department && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span aria-hidden>🏢</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {emp.department}
            </span>
          </div>
        )}
        {emp.location && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span aria-hidden>📍</span>
            <span>{emp.location}</span>
          </div>
        )}
        {emp.extension && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span aria-hidden>📞</span>
            <span>Ext: {emp.extension}</span>
          </div>
        )}
        {emp.grade && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span aria-hidden>🏅</span>
            <span>{emp.grade}</span>
          </div>
        )}
      </div>
    </article>
  )
}

function EmployeeDetailModal({
  emp,
  onClose,
}: {
  emp: Employee
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Move focus into modal when it opens (WCAG 2.4.3 Focus Order)
    closeRef.current?.focus()
  }, [])

  const avatarColors = [ASHOKA_BLUE, '#1a6d3c', '#7c2d12', '#4c1d95', '#064e3b', '#831843', '#92400e']
  const color = avatarColors[(emp.name.charCodeAt(0) ?? 0) % avatarColors.length]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Employee details: ${emp.name}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--surface, #fff)',
          borderRadius: 12,
          padding: 24,
          maxWidth: 400,
          width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <Avatar name={emp.name} color={color} size="xl" />
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--fg, #0f172a)' }}>
              {emp.name}
            </h2>
            <div style={{ fontSize: 13, color: ASHOKA_BLUE, fontWeight: 600, marginTop: 2 }}>
              {emp.designation}
            </div>
          </div>
        </div>
        <dl style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Department', value: emp.department },
            { label: 'Grade', value: emp.grade },
            { label: 'Location', value: emp.location },
            { label: 'Extension', value: emp.extension },
            { label: 'Email', value: emp.email },
          ]
            .filter((f) => f.value)
            .map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', gap: 8 }}>
                <dt style={{ fontWeight: 700, color: 'var(--muted, #64748b)', minWidth: 90 }}>{label}</dt>
                <dd style={{ margin: 0, color: 'var(--fg, #0f172a)', wordBreak: 'break-word' }}>
                  {label === 'Email' ? (
                    <a href={`mailto:${value}`} style={{ color: ASHOKA_BLUE }}>
                      {value}
                    </a>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
        </dl>
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Close employee details"
          style={{
            marginTop: 20,
            width: '100%',
            padding: '10px 0',
            background: ASHOKA_BLUE,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}

export function DirectoryClient({ employees }: DirectoryClientProps) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Employee | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return employees
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q) ||
        (e.designation ?? '').toLowerCase().includes(q) ||
        (e.extension ?? '').toLowerCase().includes(q) ||
        (e.location ?? '').toLowerCase().includes(q),
    )
  }, [employees, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSearch = useCallback((v: string) => {
    setSearch(v)
    setPage(1)
  }, [])

  const handleSelect = useCallback(
    (id: string) => {
      const emp = employees.find((e) => e.id === id) ?? null
      setSelected(emp)
    },
    [employees],
  )

  return (
    <div>
      {/* Toolbar */}
      <div
        style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}
        role="toolbar"
        aria-label="Directory controls"
      >
        <label style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="sr-only">Search employees</span>
          <input
            type="search"
            placeholder="Search by name, dept, designation, extension or location…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            aria-label="Search employee directory"
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
        <div role="group" aria-label="View mode" style={{ display: 'flex', gap: 4 }}>
          {(['grid', 'table'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              aria-label={`${mode === 'grid' ? 'Card grid' : 'Table'} view`}
              style={{
                border: '1.5px solid',
                borderColor: viewMode === mode ? ASHOKA_BLUE : 'var(--border, #e2e8f0)',
                borderRadius: 6,
                background: viewMode === mode ? '#e6f0ff' : 'var(--surface, #fff)',
                color: viewMode === mode ? ASHOKA_BLUE : 'var(--fg, #0f172a)',
                fontWeight: 600,
                fontSize: 12,
                padding: '8px 14px',
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              {mode === 'grid' ? '⊞ Cards' : '☰ Table'}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <p
        aria-live="polite"
        aria-atomic="true"
        style={{ fontSize: 12, color: 'var(--muted, #64748b)', marginBottom: 12 }}
      >
        {filtered.length === employees.length
          ? `${employees.length} employees`
          : `${filtered.length} of ${employees.length} employees`}
        {totalPages > 1 && ` — page ${page} of ${totalPages}`}
      </p>

      {paginated.length === 0 ? (
        <div
          role="status"
          style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted, #64748b)', fontSize: 14 }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
          <div style={{ fontWeight: 600 }}>No employees found</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Try a different search term.</div>
        </div>
      ) : viewMode === 'grid' ? (
        <div
          role="list"
          aria-label="Employee cards"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          {paginated.map((emp) => (
            <div key={emp.id} role="listitem">
              <EmployeeCard emp={emp} onClick={handleSelect} />
            </div>
          ))}
        </div>
      ) : (
        /* Table view */
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
            aria-label="Employee directory table"
          >
            <thead>
              <tr>
                {['Name', 'Department', 'Designation', 'Grade', 'Extension', 'Location'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    style={{
                      padding: '10px 12px',
                      textAlign: 'left',
                      borderBottom: '2px solid var(--border, #e2e8f0)',
                      fontWeight: 700,
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      color: 'var(--muted, #64748b)',
                      background: 'var(--table-head-bg, #f8fafc)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((emp) => (
                <tr
                  key={emp.id}
                  onClick={() => handleSelect(emp.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSelect(emp.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`View details for ${emp.name}`}
                  style={{
                    borderBottom: '1px solid var(--border, #e2e8f0)',
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{emp.name}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted, #64748b)' }}>{emp.department || '—'}</td>
                  <td style={{ padding: '10px 12px', color: ASHOKA_BLUE, fontSize: 12 }}>{emp.designation || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted, #64748b)' }}>{emp.grade || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{emp.extension || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted, #64748b)' }}>{emp.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          aria-label="Directory pagination"
          style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            aria-label="Previous page"
            style={paginationBtn(page === 1)}
          >
            ← Prev
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const pg = totalPages <= 7 ? i + 1 : page <= 4 ? i + 1 : page + i - 3
            if (pg < 1 || pg > totalPages) return null
            return (
              <button
                key={pg}
                onClick={() => setPage(pg)}
                aria-current={pg === page ? 'page' : undefined}
                aria-label={`Page ${pg}`}
                style={{
                  ...paginationBtn(false),
                  background: pg === page ? ASHOKA_BLUE : undefined,
                  color: pg === page ? '#fff' : undefined,
                  borderColor: pg === page ? ASHOKA_BLUE : undefined,
                  fontWeight: pg === page ? 700 : undefined,
                }}
              >
                {pg}
              </button>
            )
          })}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            aria-label="Next page"
            style={paginationBtn(page === totalPages)}
          >
            Next →
          </button>
        </nav>
      )}

      {selected && <EmployeeDetailModal emp={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function paginationBtn(disabled: boolean): React.CSSProperties {
  return {
    border: '1.5px solid var(--border, #e2e8f0)',
    borderRadius: 6,
    background: 'var(--surface, #fff)',
    color: disabled ? 'var(--muted, #64748b)' : 'var(--fg, #0f172a)',
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    minHeight: 44,
  }
}
