import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { getTranslations } from "next-intl/server";
import { formatPercent } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getData, type Row } from "./_data";
import { VACANCY_ALERT_THRESHOLD_PCT, countOverVacancyThreshold, isOverVacancyThreshold } from "./vacancyAlert";

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

  // GAP-HR-WORKFORCE-STAFFING-PLAN-01: departments whose vacancy exceeds the
  // threshold are flagged per row (pre-formatted string: this is a Server
  // Component, so no render function can cross into DataTable) and counted in
  // an alert banner.
  const overThreshold = errored ? 0 : countOverVacancyThreshold(items);
  const flaggedItems: Row[] = items.map((r) => ({
    ...r,
    vacancyFlag: isOverVacancyThreshold(Number(r.vacant), Number(r.sanctionedPosts))
      ? t("vacancyFlagOver", { pct: VACANCY_ALERT_THRESHOLD_PCT })
      : "—",
  }));

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "departmentCadre", label: t("colDepartmentCadre") },
    { key: "planYear", label: t("colPlanYear"), align: "right" },
    { key: "sanctionedPosts", label: t("colSanctioned"), align: "right" },
    { key: "filled", label: t("colFilled"), align: "right" },
    { key: "vacant", label: t("colVacant"), align: "right" },
    { key: "fillPercentage", label: t("colFillPercent"), align: "right" },
    { key: "vacancyFlag", label: t("colVacancyAlert") },
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

      {overThreshold > 0 && (
        <div role="alert" className="pill warn" style={{ display: "block", padding: "10px 14px", marginBottom: 12, borderRadius: 8 }}>
          {t("vacancyAlertMessage", { count: overThreshold, pct: VACANCY_ALERT_THRESHOLD_PCT })}
        </div>
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
            rows={flaggedItems}
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
