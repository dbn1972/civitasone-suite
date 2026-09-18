import { getTranslations } from 'next-intl/server'
import { PageHeader, StatGrid, StatCard, Card, DataTable } from '../../../../_components/ds'
import { DataSourceBadge } from '../../../../_components/DataSourceBadge'
import { fetchJson, type LoaderResult } from '@/app/_data/apiClient'

export const metadata = { title: 'Staffing Plan — CivitasOne HRMS' }

type Row = {
  id: string
  department: string
  cadre: string
  sanctionedPosts: number
  filled: number
  vacant: number
  fillPercentage: number
  lastReview: string
  status: string
  vacancyAlert: boolean
} & Record<string, unknown>

type ApiRow = {
  id: string
  department: string
  cadre?: string
  sanctionedPosts?: number
  filled?: number
  vacant?: number
  fillPercentage?: number
  lastReview?: string
  status?: string
} & Record<string, unknown>

function mapRow(r: ApiRow): Row {
  const sanctionedPosts = Number(r.sanctionedPosts ?? 0)
  const filled = Number(r.filled ?? 0)
  const vacant = Number(r.vacant ?? sanctionedPosts - filled)
  const fillPct =
    sanctionedPosts > 0 ? Number(r.fillPercentage ?? Math.round((filled / sanctionedPosts) * 100)) : 0
  const vacancyPct = sanctionedPosts > 0 ? ((sanctionedPosts - filled) / sanctionedPosts) * 100 : 0
  return {
    ...r,
    cadre: r.cadre ?? '—',
    sanctionedPosts,
    filled,
    vacant,
    fillPercentage: fillPct,
    lastReview: r.lastReview ?? '—',
    status: r.status ?? 'active',
    vacancyAlert: vacancyPct > 10,
  }
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>('/api/v1/hrms/staffing-plan', [], {
    telemetryKey: 'hr.workforce.staffing-plan',
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiRow[] })?.data
      return Array.isArray(arr) ? (arr as ApiRow[]).map(mapRow) : null
    },
  })
}

export default async function StaffingPlanPage() {
  const t = await getTranslations('workforceStaffingPlan')
  const { data: items, source } = await getData()

  const totalSanctioned = items.reduce((s, i) => s + i.sanctionedPosts, 0)
  const totalFilled = items.reduce((s, i) => s + i.filled, 0)
  const totalVacant = items.reduce((s, i) => s + i.vacant, 0)
  const overallFill = totalSanctioned > 0 ? Math.round((totalFilled / totalSanctioned) * 100) : 0
  const highVacancyCount = items.filter((i) => i.vacancyAlert).length

  const columns: {
    key: keyof Row & string
    label: string
    cellType?: 'status'
    align?: 'left' | 'right'
  }[] = [
    { key: 'department', label: t('colDeptCadre') },
    { key: 'sanctionedPosts', label: t('colSanctioned'), align: 'right' },
    { key: 'filled', label: t('colFilled'), align: 'right' },
    { key: 'vacant', label: t('colVacant'), align: 'right' },
    { key: 'fillPercentage', label: t('colFillPercent'), align: 'right' },
    { key: 'lastReview', label: t('colLastReview') },
    { key: 'status', label: t('colStatus'), cellType: 'status' },
  ]

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back="/hr/workforce"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label={t('statSanctionedPosts')} value={totalSanctioned} />
        <StatCard icon="👥" iconBg="#e6f7f0" label={t('statFilledPositions')} value={totalFilled} />
        <StatCard icon="⬜" iconBg="#fff1f0" label={t('statVacantPosts')} value={totalVacant} />
        <StatCard icon="📈" iconBg="#fffbe6" label={t('statFillRate')} value={overallFill} />
      </StatGrid>

      {highVacancyCount > 0 && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: '#fff1f0',
            border: '1.5px solid #ffccc7',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 13,
            color: '#cf1322',
            marginBottom: 12,
          }}
        >
          <strong>{t('vacancyAlertLabel')}</strong> {t('vacancyAlertMessage', { count: highVacancyCount })}
        </div>
      )}

      <Card title={t('cardTitle')}>
        {items.length > 0 ? (
          <div role="region" aria-label={t('ariaTableRegion')}>
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
              aria-label={t('ariaTable')}
            >
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      style={{
                        padding: '10px 12px',
                        textAlign: c.align === 'right' ? 'right' : 'left',
                        borderBottom: '2px solid var(--border, #e2e8f0)',
                        fontWeight: 700,
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        color: 'var(--muted, #64748b)',
                        background: 'var(--table-head-bg, #f8fafc)',
                      }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const isHighVacancy = row.vacancyAlert
                  return (
                    <tr
                      key={row.id}
                      style={{
                        background: isHighVacancy ? '#fff2f0' : undefined,
                        borderBottom: '1px solid var(--border, #e2e8f0)',
                      }}
                      aria-label={
                        isHighVacancy
                          ? t('highVacancyRowAriaLabel', { department: row.department, vacant: row.vacant })
                          : undefined
                      }
                    >
                      <td style={tdBase}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isHighVacancy && (
                            <span
                              aria-label={t('highVacancyIconAriaLabel')}
                              title={t('highVacancyIconTitle')}
                              style={{ color: '#cf1322', fontWeight: 700, fontSize: 14 }}
                            >
                              ⚠
                            </span>
                          )}
                          <span>
                            {row.department}
                            {row.cadre !== '—' && (
                              <small style={{ display: 'block', color: 'var(--muted, #64748b)', fontSize: 11 }}>
                                {row.cadre}
                              </small>
                            )}
                          </span>
                        </div>
                      </td>
                      <td style={{ ...tdBase, textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                        {row.sanctionedPosts}
                      </td>
                      <td style={{ ...tdBase, textAlign: 'end', fontVariantNumeric: 'tabular-nums', color: '#1a6d3c', fontWeight: 600 }}>
                        {row.filled}
                      </td>
                      <td
                        style={{
                          ...tdBase,
                          textAlign: 'end',
                          fontVariantNumeric: 'tabular-nums',
                          color: isHighVacancy ? '#cf1322' : undefined,
                          fontWeight: isHighVacancy ? 700 : undefined,
                        }}
                      >
                        {row.vacant}
                      </td>
                      <td style={{ ...tdBase, textAlign: 'end' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <div
                            role="progressbar"
                            aria-valuenow={row.fillPercentage}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={t('fillRateAriaLabel', { pct: row.fillPercentage })}
                            style={{
                              width: 50,
                              height: 6,
                              borderRadius: 3,
                              background: 'var(--border, #e2e8f0)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(row.fillPercentage, 100)}%`,
                                height: '100%',
                                background: isHighVacancy ? '#cf1322' : '#1a6d3c',
                                borderRadius: 3,
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                            {row.fillPercentage}%
                          </span>
                        </div>
                      </td>
                      <td style={{ ...tdBase, color: 'var(--muted, #64748b)' }}>{row.lastReview}</td>
                      <td style={tdBase}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            background:
                              row.status === 'active' ? '#e6f7f0' : '#f5f5f5',
                            color:
                              row.status === 'active' ? '#1a6d3c' : '#64748b',
                          }}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t('filterPlaceholder')}
            pageSize={20}
            emptyIcon="📊"
            emptyTitle={t('emptyTitle')}
            emptyMessage={t('emptyMessage')}
          />
        )}
      </Card>

      <p style={{ fontSize: 11, color: 'var(--muted, #64748b)', marginTop: 8 }}>
        {t('footerNote')}
      </p>
    </main>
  )
}

const tdBase: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'middle',
}
