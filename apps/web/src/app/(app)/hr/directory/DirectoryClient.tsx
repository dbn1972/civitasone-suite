'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Avatar, Button, DataTable } from '@/app/_components/ds'

type Employee = {
  id: string
  name: string
  department: string
  designation?: string
  grade?: string
  email?: string
} & Record<string, unknown>

interface DirectoryClientProps {
  employees: Employee[]
  /** Current server-side search term (URL `q`), so the box reflects it on load/back-nav. */
  initialQuery: string
  /** GAP-HR-DIRECTORY-03: session may open a full profile from the dialog. */
  canViewProfiles: boolean
}

const GRID_PAGE_SIZE = 20
const ASHOKA_BLUE = '#00439C'
const SEARCH_DEBOUNCE_MS = 350

function EmployeeCard({ emp, onClick, t }: { emp: Employee; onClick: (id: string) => void; t: (key: string) => string }) {
  const avatarColors = [ASHOKA_BLUE, '#1a6d3c', '#7c2d12', '#4c1d95', '#064e3b', '#831843', '#92400e']
  const color = avatarColors[(emp.name.charCodeAt(0) ?? 0) % avatarColors.length]

  return (
    <div
      onClick={() => onClick(emp.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick(emp.id)}
      role="button"
      tabIndex={0}
      // GAP-HR-DIRECTORY-02: only append the designation when one exists --
      // it is now genuinely populated for most rows (DIRECTORY-01), but an
      // employee with no resolvable designation must never announce the
      // literal string "undefined" to a screen reader.
      aria-label={emp.designation ? `${t('viewDetailsFor')} ${emp.name}, ${emp.designation}` : `${t('viewDetailsFor')} ${emp.name}`}
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
          {emp.designation && (
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
          )}
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
        {emp.grade && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span aria-hidden>🏅</span>
            <span>{emp.grade}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function EmployeeDetailModal({
  emp,
  onClose,
  canViewProfiles,
  t,
}: {
  emp: Employee
  onClose: () => void
  canViewProfiles: boolean
  t: (key: string) => string
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Move focus into modal when it opens (WCAG 2.4.3 Focus Order)
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (e.target === dialogRef.current) onClose()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const avatarColors = [ASHOKA_BLUE, '#1a6d3c', '#7c2d12', '#4c1d95', '#064e3b', '#831843', '#92400e']
  const color = avatarColors[(emp.name.charCodeAt(0) ?? 0) % avatarColors.length]

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${t('employeeDetailsFor')} ${emp.name}`}
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
            {emp.designation && (
              <div style={{ fontSize: 13, color: ASHOKA_BLUE, fontWeight: 600, marginTop: 2 }}>
                {emp.designation}
              </div>
            )}
          </div>
        </div>
        <dl style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: t('fieldDepartment'), value: emp.department },
            { label: t('fieldGrade'), value: emp.grade },
            // GAP-HR-DIRECTORY-04 (DPDP decision, applied): work email only --
            // never mobile/PAN/bank. See docs/SECURITY.md's Directory Fields note.
            { label: t('fieldEmail'), value: emp.email },
          ]
            .filter((f) => f.value)
            .map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', gap: 8 }}>
                <dt style={{ fontWeight: 700, color: 'var(--muted, #64748b)', minWidth: 90 }}>{label}</dt>
                <dd style={{ margin: 0, color: 'var(--fg, #0f172a)', wordBreak: 'break-word' }}>
                  {label === t('fieldEmail') ? (
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {/* GAP-HR-DIRECTORY-03: a full profile link (session-role gated --
              the destination's own manager-scope check is the real
              boundary, see page.tsx's PROFILE_LINK_ROLES comment) and an
              org-chart link (open to everyone who reaches the directory). */}
          {canViewProfiles && (
            <Link href={`/hr/employees/${emp.id}`} className="btn ghost" style={{ minHeight: 44, textAlign: 'center' }}>
              {t('viewProfile')}
            </Link>
          )}
          <Link href="/hr/org-chart" className="btn ghost" style={{ minHeight: 44, textAlign: 'center' }}>
            {t('viewOrgChart')}
          </Link>
        </div>
        <Button
          ref={closeRef}
          onClick={onClose}
          aria-label={t('closeDetails')}
          style={{ marginTop: 8, width: '100%', minHeight: 44 }}
        >
          {t('close')}
        </Button>
      </div>
    </div>
  )
}

export function DirectoryClient({ employees, initialQuery, canViewProfiles }: DirectoryClientProps) {
  const t = useTranslations('directory')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [searchInput, setSearchInput] = useState(initialQuery)
  const [gridPage, setGridPage] = useState(1)
  const [selected, setSelected] = useState<Employee | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // GAP-HR-DIRECTORY-03: search is now server-driven (reaches the whole
  // directory, not just this page's loaded rows) -- debounce keystrokes into
  // a URL navigation (?q=...&page=1) rather than filtering the already-
  // loaded array client-side.
  const pushQuery = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (value.trim()) params.set('q', value.trim())
      else params.delete('q')
      params.delete('page')
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const handleSearchChange = useCallback(
    (v: string) => {
      setSearchInput(v)
      setGridPage(1)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => pushQuery(v), SEARCH_DEBOUNCE_MS)
    },
    [pushQuery],
  )

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const totalGridPages = Math.max(1, Math.ceil(employees.length / GRID_PAGE_SIZE))
  const gridPaginated = employees.slice((gridPage - 1) * GRID_PAGE_SIZE, gridPage * GRID_PAGE_SIZE)

  const handleSelect = useCallback(
    (id: string) => {
      const emp = employees.find((e) => e.id === id) ?? null
      setSelected(emp)
    },
    [employees],
  )

  const columns: { key: keyof Employee & string; label: string; render?: (row: Employee) => React.ReactNode }[] = [
    {
      key: 'name',
      label: t('colName'),
      render: (row) => (
        <button
          type="button"
          onClick={() => handleSelect(row.id)}
          aria-label={`${t('viewDetailsFor')} ${row.name}`}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            font: 'inherit',
            fontWeight: 600,
            color: 'var(--fg, #0f172a)',
            cursor: 'pointer',
            textAlign: 'left',
            minHeight: 44,
          }}
        >
          {row.name}
        </button>
      ),
    },
    { key: 'department', label: t('colDepartment') },
    { key: 'designation', label: t('colDesignation') },
    { key: 'grade', label: t('colGrade') },
  ]

  return (
    <div>
      {/* GAP-HR-DIRECTORY-04: visible DPDP purpose notice (was previously
          undocumented -- see docs/SECURITY.md's Directory Fields policy). */}
      <p role="note" style={{ fontSize: 12, color: 'var(--muted, #64748b)', marginBottom: 12 }}>
        {t('dpdpNotice')}
      </p>

      {/* Toolbar */}
      <div
        style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}
        role="toolbar"
        aria-label={t('toolbarLabel')}
      >
        <label style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="sr-only">{t('searchAriaLabel')}</span>
          <input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label={t('searchAriaLabel')}
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
        <div role="group" aria-label={t('viewModeGroupLabel')} style={{ display: 'flex', gap: 4 }}>
          {(['grid', 'table'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              aria-label={mode === 'grid' ? t('viewCards') : t('viewTable')}
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
              <span aria-hidden>{mode === 'grid' ? '⊞ ' : '☰ '}</span>
              {mode === 'grid' ? t('viewCards') : t('viewTable')}
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
        {t('employeeCount', { count: employees.length })}
        {viewMode === 'grid' && totalGridPages > 1 && ` — ${tCommon('page')} ${gridPage} ${tCommon('of')} ${totalGridPages}`}
      </p>

      {employees.length === 0 ? (
        <div
          role="status"
          style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted, #64748b)', fontSize: 14 }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>👥</div>
          <div style={{ fontWeight: 600 }}>{t('noResultsTitle')}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{t('noResultsHint')}</div>
        </div>
      ) : viewMode === 'grid' ? (
        <div
          role="list"
          aria-label={t('cardsListLabel')}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          {gridPaginated.map((emp) => (
            <div key={emp.id} role="listitem">
              <EmployeeCard emp={emp} onClick={handleSelect} t={t} />
            </div>
          ))}
        </div>
      ) : (
        // GAP-HR-DIRECTORY-05: shared DataTable instead of a hand-rolled
        // <table role=button tr onClick>, which dropped native row/AT
        // semantics and had no responsive mobile transform. The name cell's
        // own <button> (columns above) keeps the row-open affordance without
        // borrowing DataTable's href-based row-link (there is no href here,
        // this opens a modal). `mobileStack` opts this table (only) into the
        // new stacked-row layout below 768px -- every other DataTable
        // consumer is unaffected by default.
        <DataTable<Employee>
          columns={columns}
          rows={gridPaginated}
          sortable
          mobileStack
          caption={t('tableAriaLabel')}
        />
      )}

      {/* Grid-view pagination (client-side chunking of this server page's
          rows -- unrelated to the server-side `page` param below, same as
          every other DataTable consumer's own `pageSize` chunking). */}
      {viewMode === 'grid' && totalGridPages > 1 && (
        <nav
          aria-label={t('paginationLabel')}
          style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}
        >
          <Button
            variant="ghost"
            onClick={() => setGridPage((p) => Math.max(1, p - 1))}
            disabled={gridPage === 1}
            aria-label={t('prevPageAriaLabel')}
          >
            ← {tCommon('back')}
          </Button>
          {Array.from({ length: Math.min(totalGridPages, 7) }, (_, i) => {
            const pg = totalGridPages <= 7 ? i + 1 : gridPage <= 4 ? i + 1 : gridPage + i - 3
            if (pg < 1 || pg > totalGridPages) return null
            return (
              <button
                key={pg}
                onClick={() => setGridPage(pg)}
                aria-current={pg === gridPage ? 'page' : undefined}
                aria-label={`${t('pageNumberAriaLabel')} ${pg}`}
                style={{
                  ...paginationBtn(false),
                  background: pg === gridPage ? ASHOKA_BLUE : undefined,
                  color: pg === gridPage ? '#fff' : undefined,
                  borderColor: pg === gridPage ? ASHOKA_BLUE : undefined,
                  fontWeight: pg === gridPage ? 700 : undefined,
                }}
              >
                {pg}
              </button>
            )
          })}
          <Button
            variant="ghost"
            onClick={() => setGridPage((p) => Math.min(totalGridPages, p + 1))}
            disabled={gridPage === totalGridPages}
            aria-label={t('nextPageAriaLabel')}
          >
            {tCommon('next')} →
          </Button>
        </nav>
      )}

      {selected && (
        <EmployeeDetailModal emp={selected} onClose={() => setSelected(null)} canViewProfiles={canViewProfiles} t={t} />
      )}
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
