import { getTranslations } from 'next-intl/server'
import { PageHeader, StatGrid, StatCard, Card, DataTable } from '../../../../_components/ds'
import { DataSourceBadge } from '../../../../_components/DataSourceBadge'
import { fetchJson, type LoaderResult } from '@/app/_data/apiClient'

export const metadata = { title: 'Work Summary — CivitasOne HRMS' }

type ApiRow = {
  id: string
  employee?: string
  employeeName?: string
  department?: string
  period?: string
  periodType?: string
  tasksCompleted?: number
  totalTasks?: number
  rating?: number | string
  status: string
}

type Row = {
  id: string
  employee: string
  department: string
  period: string
  periodType: string
  tasks: string
  rating: string
  status: string
} & Record<string, unknown>

function mapRows(apiItems: ApiRow[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    employee: s.employee ?? s.employeeName ?? '—',
    department: s.department ?? '—',
    period: s.period ?? '—',
    periodType: s.periodType ?? '—',
    tasks:
      s.tasksCompleted != null && s.totalTasks != null
        ? `${s.tasksCompleted} / ${s.totalTasks}`
        : '—',
    rating: s.rating != null ? `${Number(s.rating).toFixed(1)} / 5` : '—',
    status: s.status,
  }))
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>('/api/v1/hrms/work-summaries', [], {
    telemetryKey: 'hr.workforce.work-summaries',
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiRow[] })?.data
      return Array.isArray(arr) ? mapRows(arr as ApiRow[]) : null
    },
  })
}

export default async function WorkSummaryPage() {
  const t = await getTranslations('workforceWorkSummary')
  const { data: items, source } = await getData()

  const reviewed = items.filter((i) =>
    ['approved', 'accepted', 'finalised'].includes(i.status),
  ).length
  const pending = items.filter((i) =>
    ['pending', 'submitted'].includes(i.status),
  ).length
  const employees = new Set(items.map((i) => i.employee).filter((e) => e !== '—')).size

  const columns: {
    key: keyof Row & string
    label: string
    cellType?: 'status'
    align?: 'left' | 'right'
  }[] = [
    { key: 'employee', label: t('colEmployee') },
    { key: 'department', label: t('colDepartment') },
    { key: 'period', label: t('colPeriod') },
    { key: 'periodType', label: t('colType') },
    { key: 'tasks', label: t('colTasksCompleted') },
    { key: 'rating', label: t('colSupervisorRating') },
    { key: 'status', label: t('colStatus'), cellType: 'status' },
  ]

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back="/hr/workforce" backLabel="Back to Workforce"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📝" iconBg="#e6f0ff" label={t('statTotalRecords')} value={items.length} />
        <StatCard icon="👤" iconBg="#f5f5f5" label={t('statEmployees')} value={employees} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t('statReviewed')} value={reviewed} />
        <StatCard icon="⏳" iconBg="#fffbe6" label={t('statPendingReview')} value={pending} />
      </StatGrid>

      <Card title={t('cardTitle')}>
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t('filterPlaceholder')}
          pageSize={20}
          emptyIcon="📝"
          emptyTitle={t('emptyTitle')}
          emptyMessage={t('emptyMessage')}
        />
      </Card>

      <p style={{ fontSize: 11, color: 'var(--muted, #64748b)', marginTop: 8 }}>
        {t('footerNote')}
      </p>
    </main>
  )
}
