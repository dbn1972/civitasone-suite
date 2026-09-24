import { getTranslations } from 'next-intl/server'
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from '../../../../_components/ds'
import { DataSourceBadge } from '../../../../_components/DataSourceBadge'
import { fetchJson, type LoaderResult } from '@/app/_data/apiClient'
import { toHumanError } from "@/lib/messages";

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
  const errored = source === "error";

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
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back="/hr/workforce" backLabel="Back to Workforce"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg, #e6f0ff)" label={t('statSanctionedPosts')} value={errored ? null : totalSanctioned} />
        <StatCard icon="👥" iconBg="var(--goodbg, #e6f7f0)" label={t('statFilledPositions')} value={errored ? null : totalFilled} />
        <StatCard icon="⬜" iconBg="var(--badbg, #fff1f0)" label={t('statVacantPosts')} value={errored ? null : totalVacant} />
        <StatCard icon="📈" iconBg="var(--warnbg, #fffbe6)" label={t('statFillRate')} value={errored ? null : overallFill} />
      </StatGrid>

      {highVacancyCount > 0 && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: 'var(--badbg, #fff1f0)',
            border: '1.5px solid var(--badbd, #ffccc7)',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 13,
            color: 'var(--bad, #cf1322)',
            marginBottom: 12,
          }}
        >
          <strong>{t('vacancyAlertLabel')}</strong> {t('vacancyAlertMessage', { count: highVacancyCount })}
        </div>
      )}

      <Card title={t('cardTitle')}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "staffing plan" })} backHref="/hr/workforce" />
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
    </div>
  )
}

