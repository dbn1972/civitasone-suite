import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { formatPercent, formatIndianDate } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * GAP-HR-STAFFING-PLAN-04: mirrors gap-features/routes.ts's own HR_ROLES
 * exactly for GET /v1/hrms/staffing-plan. The broader /hr layout gate
 * (apps/web/src/lib/auth/workRoles.ts's HR_ROLES) also admits
 * payroll_officer/payroll_admin/tenant_admin/platform_admin/manager/
 * employee/icc_member/admin/officer/finance_officer/finance_admin to the
 * page SHELL, but this endpoint's own backend guard does not -- any of
 * those roles got a bare 403 that the page rendered as a generic
 * retryable network-error state. Pre-checked here (same dual-layer
 * pattern as hr/audit-log/page.tsx's AUDIT_LOG_ROLES) so a known-denied
 * caller gets an honest "Access restricted" message without even
 * attempting the fetch; LoadErrorState below still handles a live 403
 * reactively too, in case this list and the backend's ever drift apart.
 */
const STAFFING_PLAN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type ApiRow = {
  id: string;
  department: string | null;
  cadre: string;
  sanctionedPosts: number;
  filled: number;
  vacant: number;
  fillPercentage: number | string;
  lastReview: string | null;
  planYear: number;
  status: string;
} & Record<string, unknown>;

type Row = {
  id: string;
  departmentCadre: string;
  sanctionedPosts: number;
  filled: number;
  vacant: number;
  fillPercentage: string;
  lastReview: string;
  planYear: number;
  status: string;
} & Record<string, unknown>;

type StaffingPlanPayload = {
  items: Row[];
  planYear: number | null;
  availableYears: number[];
};

/**
 * GAP-HR-STAFFING-PLAN-03: the column was labelled "Department / Cadre" but
 * only `department` was ever shown -- `cadre` was fetched and typed on the
 * row, but silently dropped on display, so two plans in the same
 * department with different cadres rendered as identical rows. Combined
 * into a single pre-formatted string here rather than a DataTable `render:`
 * column function, because this page is a Server Component and DataTable
 * ("use client") cannot receive a function prop across that boundary --
 * see scripts/ci/datatable-render-guard.mjs's own doc comment for the
 * exact crash class (GAP-HR-EXPENSES-01) this sidesteps.
 *
 * `department` is now `d.name` alone (nullable) rather than the backend's
 * old `COALESCE(d.name, p.cadre)` -- when there is no resolvable
 * department link, falling back to showing cadre alone (not "Cadre /
 * Cadre") avoids a redundant, confusing combined label.
 */
export function departmentCadreLabel(department: string | null, cadre: string): string {
  if (!department || department === cadre) return cadre;
  return `${department} / ${cadre}`;
}

export function mapRows(apiRows: ApiRow[]): Row[] {
  return apiRows.map((r) => ({
    ...r,
    // GAP-HR-STAFFING-PLAN-01: Postgres returns a `numeric` column as a
    // STRING over the wire via the postgres-js driver by default (e.g.
    // "87.5") -- formatPercent's Number.isFinite guard is false for a
    // string, so this always rendered '—' for every live row. Number(...)
    // coerces before formatting; the SQL side now also casts ::float8 so
    // the API contract is actually a number -- this is a defensive second
    // layer, not the only fix.
    fillPercentage: formatPercent(Number(r.fillPercentage), 1),
    // GAP-HR-STAFFING-PLAN-02: previously a raw, unformatted ISO datetime
    // string with no "—" fallback.
    lastReview: r.lastReview ? formatIndianDate(r.lastReview) : "—",
    departmentCadre: departmentCadreLabel(r.department, r.cadre),
  }));
}

async function getData(year?: number): Promise<LoaderResult<StaffingPlanPayload>> {
  const qs = year ? `?year=${year}` : "";
  return fetchJson<unknown, StaffingPlanPayload>(`/api/v1/hrms/staffing-plan${qs}`, { items: [], planYear: null, availableYears: [] }, {
    telemetryKey: "hr.staffing-plan",
    mapResponse: (p) => {
      const payload = p as { data?: ApiRow[]; meta?: { planYear?: number; availableYears?: number[] } } | ApiRow[];
      const arr = Array.isArray(payload) ? payload : payload?.data;
      if (!Array.isArray(arr)) return null;
      const meta = Array.isArray(payload) ? undefined : payload?.meta;
      return {
        items: mapRows(arr as ApiRow[]),
        planYear: meta?.planYear ?? null,
        availableYears: meta?.availableYears ?? [],
      };
    },
  });
}

const YEAR_RE = /^\d{4}$/;

export default async function StaffingPlanPage({ searchParams }: { searchParams?: { year?: string } }) {
  // GAP-HR-STAFFING-PLAN-04 (web half): checked before even attempting the
  // fetch -- see STAFFING_PLAN_ROLES doc comment above.
  const roles = getSessionRoles();
  if (!roles.some((r) => STAFFING_PLAN_ROLES.includes(r))) {
    return <PermissionDenied module="the staffing plan" requiredRoles={STAFFING_PLAN_ROLES} />;
  }

  const t = await getTranslations("staffingPlan");
  const requestedYear = searchParams?.year && YEAR_RE.test(searchParams.year) ? Number(searchParams.year) : undefined;
  const result = await getData(requestedYear);
  const { data, source } = result;
  const { items, planYear, availableYears } = data;
  const errored = source === "error";

  const totalSanctioned = items.reduce((s, i) => s + Number(i.sanctionedPosts ?? 0), 0);
  const totalFilled = items.reduce((s, i) => s + Number(i.filled ?? 0), 0);
  const totalVacant = items.reduce((s, i) => s + Number(i.vacant ?? 0), 0);
  // GAP-HR-STAFFING-PLAN-05: 0/0 is undefined, not 0 -- a tenant with zero
  // sanctioned posts (so far) was showing a misleading "0%" fill rate.
  const overallFillLabel = totalSanctioned > 0
    ? formatPercent(Math.round((totalFilled / totalSanctioned) * 100), 0)
    : "—";

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "departmentCadre", label: t("colDepartmentCadre") },
    { key: "planYear", label: t("colPlanYear"), align: "right" },
    { key: "sanctionedPosts", label: t("colSanctioned"), align: "right" },
    { key: "filled", label: t("colFilled"), align: "right" },
    { key: "vacant", label: t("colVacant"), align: "right" },
    { key: "fillPercentage", label: t("colFillPercent"), align: "right" },
    { key: "lastReview", label: t("colLastReview") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backToHr")}
        actions={<span />}
      />
      <DataSourceBadge source={source} />

      {/* GAP-HR-STAFFING-PLAN-04: year selector -- a plain GET form (no JS
          needed to apply it), same idiom as hr/payroll/form16's
          FyLookupForm and hr/audit-log's from/to date filter. */}
      {!errored && availableYears.length > 0 && (
        <form method="GET" style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="staffing-plan-year" style={{ fontSize: 13, fontWeight: 600 }}>
              {t("yearSelectorLabel")}
            </label>
            <select
              id="staffing-plan-year"
              name="year"
              defaultValue={String(planYear ?? availableYears[0])}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn ghost" style={{ minHeight: 44 }}>
            {t("applyYearLabel")}
          </button>
        </form>
      )}

      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg, #e6f0ff)" label={t("statSanctionedPostsLabel")} value={errored ? null : totalSanctioned} />
        <StatCard icon="👥" iconBg="var(--goodbg, #e6f7f0)" label={t("statFilledLabel")} value={errored ? null : totalFilled} />
        <StatCard icon="⬜" iconBg="var(--badbg, #fff1f0)" label={t("statVacantLabel")} value={errored ? null : totalVacant} />
        <StatCard icon="📈" iconBg="var(--warnbg, #fffbe6)" label={t("statFillRateLabel")} value={errored ? null : overallFillLabel} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={result} area="staffing plan" backHref="/hr" requiredRoles={STAFFING_PLAN_ROLES} />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📊"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
