import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card } from '../../../_components/ds'
import { DataSourceBadge } from '../../../_components/DataSourceBadge'
import { fetchJson, type LoaderResult } from '@/app/_data/apiClient'
import { DirectoryClient } from './DirectoryClient'

export const metadata = { title: 'Employee Directory — CivitasOne HRMS' }

type Row = {
  id: string
  name: string
  department: string
  designation: string
  grade: string
  extension: string
  email: string
  location: string
} & Record<string, unknown>

// The API caps this list at 200 and reports whether more rows exist via
// `pagination.hasMore` (see services/hrms-service employee/queries.ts —
// there is no tenant-wide total/count on this endpoint, only a cursor-style
// `hasMore`). We surface that flag so the page can stop presenting a
// truncated page as if it were the whole directory (search below is also
// scoped to only these loaded rows).
type DirectoryData = { items: Row[]; hasMore: boolean }

async function getData(): Promise<LoaderResult<DirectoryData>> {
  return fetchJson<unknown, DirectoryData>('/api/v1/hrms/employees?limit=200', { items: [], hasMore: false }, {
    telemetryKey: 'hr.employees_limit_200',
    mapResponse: (p) => {
      const body = p as { data?: Row[]; pagination?: { hasMore?: boolean } }
      const arr = Array.isArray(p) ? p : body?.data
      if (!Array.isArray(arr)) return null
      return { items: arr, hasMore: Boolean(body?.pagination?.hasMore) }
    },
  })
}

export default async function DirectoryPage() {
  const t = await getTranslations("directory");
  const { data, source } = await getData()
  const { items, hasMore } = data

  const depts = new Set(items.map((i) => i.department).filter(Boolean)).size
  const locations = new Set(items.map((i) => i.location).filter(Boolean)).size
  const designations = new Set(items.map((i) => i.designation).filter(Boolean)).size

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      {hasMore && (
        <span
          role="status"
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
          style={{ marginBottom: 12 }}
        >
          {t("hasMoreWarning", { count: items.length })}
        </span>
      )}
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f0ff" label={hasMore ? t("statEmployeesShown") : t("statTotalEmployees")} value={items.length} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label={t("statDepartments")} value={depts} />
        <StatCard icon="📍" iconBg="#fffbe6" label={t("statLocations")} value={locations} />
        <StatCard icon="📛" iconBg="#e6f7f0" label={t("statDesignations")} value={designations} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <DirectoryClient employees={items} />
      </Card>
    </main>
  )
}
