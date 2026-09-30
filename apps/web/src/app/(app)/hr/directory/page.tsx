import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from '../../../_components/ds'
import { DataSourceBadge } from '../../../_components/DataSourceBadge'
import { fetchJson, type LoaderResult } from '@/app/_data/apiClient'
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { EMPLOYEE_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { DirectoryClient } from './DirectoryClient'
import { toHumanError } from "@/lib/messages";

export const metadata = { title: 'Employee Directory — CivitasOne HRMS' }

type Row = {
  id: string
  name: string
  department: string
  designation?: string
  grade?: string
  email?: string
} & Record<string, unknown>

// GAP-HR-DIRECTORY-03: session roles allowed a "View profile" link to
// /hr/employees/{id} from the directory dialog. Mirrors
// employee/routes.ts's READER_ROLES (HR_ROLES + "manager") on the backend
// GET /v1/hrms/employees/:id route -- a manager who clicks through to
// someone who isn't their direct report still correctly gets a 403 there
// (resolveManagerScope), same as every other manager-scoped read in this
// module; this is a navigation-level offer, not the access boundary.
const PROFILE_LINK_ROLES = [...EMPLOYEE_ADMIN_ROLES, "manager"];

// Server-side page size for the directory's own pagination (GAP-HR-
// DIRECTORY-03) -- unchanged from the previous hard cap's number, but now a
// real "load next page" instead of a dead end; q is forwarded to the API so
// search reaches beyond whatever page is currently loaded (previously: a
// client-only .filter() over just the first 200 rows, so e.g. employee #250
// could never be found by name).
const PAGE_SIZE = 200;

type DirectoryData = { items: Row[]; hasMore: boolean }

async function getData(q: string | undefined, offset: number): Promise<LoaderResult<DirectoryData>> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (q) params.set('q', q);
  return fetchJson<unknown, DirectoryData>(`/api/v1/hrms/employees?${params.toString()}`, { items: [], hasMore: false }, {
    telemetryKey: 'hr.employees_directory',
    mapResponse: (p) => {
      const body = p as { data?: Row[]; pagination?: { hasMore?: boolean } }
      const arr = Array.isArray(p) ? p : body?.data
      if (!Array.isArray(arr)) return null
      return { items: arr, hasMore: Boolean(body?.pagination?.hasMore) }
    },
  })
}

export default async function DirectoryPage({ searchParams }: { searchParams?: Record<string, string> }) {
  const t = await getTranslations("directory");
  const roles = getSessionRoles();
  const canViewProfiles = roles.some((r) => PROFILE_LINK_ROLES.includes(r));

  const q = searchParams?.q?.trim() || undefined;
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, source } = await getData(q, offset)
  const errored = source === "error";
  const { items, hasMore } = data

  const depts = new Set(items.map((i) => i.department).filter(Boolean)).size
  const designations = new Set(items.map((i) => i.designation).filter(Boolean)).size
  // GAP-HR-DIRECTORY-01: `location` is not (yet) a real field anywhere in
  // the response -- hrms_employees has no location/extension column (see
  // employee/queries.ts's listEmployees doc comment) -- so this stays a
  // permanent dash rather than a fabricated 0 or a count that can never be
  // anything but empty.
  const locations: number | null = null

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      {hasMore && (
        <a
          href={`/hr/directory?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) }).toString()}`}
          role="status"
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
          style={{ marginBottom: 12, textDecoration: 'underline' }}
        >
          {t("hasMoreWarning", { count: items.length })}
        </a>
      )}
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg, #e6f0ff)" label={hasMore ? t("statEmployeesShown") : t("statTotalEmployees")} value={errored ? null : items.length} />
        <StatCard icon="🏢" iconBg="var(--bg, #f5f5f5)" label={t("statDepartments")} value={errored ? null : depts} />
        <StatCard icon="📍" iconBg="var(--warnbg, #fffbe6)" label={t("statLocations")} value={locations} />
        <StatCard icon="📛" iconBg="var(--goodbg, #e6f7f0)" label={t("statDesignations")} value={errored ? null : designations} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "directory" })} backHref="/hr" />
          </div>
        ) : (
          <DirectoryClient employees={items} initialQuery={q ?? ''} canViewProfiles={canViewProfiles} />
        )}
      </Card>
    </div>
  )
}
