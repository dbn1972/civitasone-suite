import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import type { LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { isValidPeriod } from "@/lib/payroll/period";
import { formatMoney, formatShortId } from "@/lib/formatters";
import { employeeDisplayLabel, resolveEmployeeNames } from "@/app/_data/employeeNames";
import { AllocationForm } from "./AllocationForm";
import { AllocationsTable, type AllocationTableRow } from "./AllocationsTable";
import { ProjectCostingRangeForm } from "./ProjectCostingRangeForm";
import {
  PROJECT_COSTING_APPROVE_ROLES, PROJECT_COSTING_TOTALS_ROLES, PROJECT_COSTING_VIEW_ROLES, PROJECT_COSTING_WRITE_ROLES,
  getAllocations, getByCostCenter, getByProject, getCostCenters, getProjectIndex, getSettings,
  type CostCenterCostRow, type ProjectCostReport, type UnallocatedRow,
} from "./projectCostingData";

type Row = Record<string, unknown>;

/**
 * Project costing (S8 G7, MIS layer v1): charge an employee's salary cost to
 * projects or cost centres by percentage and date, approve it (maker-checker),
 * and read the cost by project and by cost centre. A project manager has no
 * access here; they read their own project's totals under /projects/[id].
 */
export default async function ProjectCostingPage(props: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await props.searchParams;
  const t = await getTranslations("projectCosting");
  const roles = getSessionRoles();
  if (!roles.some((r) => PROJECT_COSTING_VIEW_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="project costing" requiredRoles={PROJECT_COSTING_VIEW_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const canSeeTotals = roles.some((r) => PROJECT_COSTING_TOTALS_ROLES.includes(r));
  const canRequest = roles.some((r) => PROJECT_COSTING_WRITE_ROLES.includes(r));
  const canDecide = roles.some((r) => PROJECT_COSTING_APPROVE_ROLES.includes(r));
  const currentUserId = getSessionUserId();

  const fromRaw = sp.from?.trim() ?? "";
  const toRaw = sp.to?.trim() ?? "";
  const rangeValid = isValidPeriod(fromRaw) && isValidPeriod(toRaw) && fromRaw <= toRaw;
  const rangeInvalid = Boolean(fromRaw || toRaw) && !rangeValid;

  const empty = <T,>(d: T): Promise<LoaderResult<T>> => Promise.resolve({ data: d, source: "api" } as LoaderResult<T>);
  const [settings, allocations, projects, centers, byProject, byCc] = await Promise.all([
    getSettings(), getAllocations(), getProjectIndex(), getCostCenters(),
    canSeeTotals && rangeValid ? getByProject(fromRaw, toRaw) : empty<ProjectCostReport>({ rows: [], minCohort: null }),
    canSeeTotals && rangeValid ? getByCostCenter(fromRaw, toRaw) : empty<{ data: CostCenterCostRow[]; unallocated: UnallocatedRow[] }>({ data: [], unallocated: [] }),
  ]);
  const names = await resolveEmployeeNames(allocations.data.map((a) => a.employeeId));
  const projectMap = new Map(projects.data.map((p) => [p.projectId, p]));
  const centerMap = new Map(centers.data.map((c) => [c.id, c]));
  const projectLabel = (id: string | null) => { if (!id) return "—"; const p = projectMap.get(id); return p ? `${p.code} — ${p.name}` : t("unresolved", { id: formatShortId(id) }); };
  const centerLabel = (id: string) => { const c = centerMap.get(id); return c ? `${c.code} — ${c.name}` : t("unresolved", { id: formatShortId(id) }); };
  const personLabel = (id: string) => employeeDisplayLabel(names, id, formatShortId(id));
  const enabled = settings.data.enabled;

  const minCohort = byProject.data.minCohort ?? 3;
  const hiddenCell = t("suppressedCell", { n: minCohort });
    const projectRows: Row[] = byProject.data.rows.map((r) => ({
    id: `${r.period}:${r.projectId}`, period: r.period, project: projectLabel(r.projectId), gross: r.grossMinor, employer: r.employerCostMinor, total: r.totalCostMinor, headcount: r.headcount,
    hidden: r.suppressed,
  }));
  const ccRows: Row[] = [
    ...byCc.data.data.map((r) => ({ id: `${r.period}:${r.costCenterId}`, period: r.period, costCenter: centerLabel(r.costCenterId), gross: r.grossMinor, employer: r.employerCostMinor, total: r.totalCostMinor, headcount: r.headcount, hidden: r.suppressed })),
    ...byCc.data.unallocated.map((r) => ({ id: `${r.period}:unallocated`, period: r.period, costCenter: t("unallocatedRow"), gross: r.grossMinor, employer: r.employerCostMinor, total: r.totalCostMinor, headcount: r.headcount, hidden: r.suppressed })),
  ];
  const showMoney = (v: unknown, hidden: unknown) => (hidden === true ? hiddenCell : formatMoney(v as string));
  const anyHidden = [...projectRows, ...ccRows].some((r) => r.hidden === true);
  // The totals above the table add up the VISIBLE rows only.
  const sumVisible = (k: "gross" | "total") => projectRows.reduce((s, r) => (r.hidden ? s : s + BigInt(String(r[k]))), 0n);
  const reportErrored = byProject.source === "error" || byCc.source === "error";
  const allocationRows: AllocationTableRow[] = allocations.data.map((a) => ({
    id: a.id, person: personLabel(a.employeeId), target: a.targetType === "project" ? projectLabel(a.projectId) : centerLabel(a.costCenterId),
    pct: `${Number(a.splitPct)}%`, window: `${a.effectiveFrom} → ${a.effectiveTo ?? t("openEnded")}`, status: t(`status_${a.status}`),
    pending: a.status === "pending", requestedBy: a.requestedBy, label: `${personLabel(a.employeeId)} ${Number(a.splitPct)}%`,
  }));

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />
      {!enabled && <p role="status" className="pill warn" style={{ margin: "0 0 12px", width: "fit-content" }}>{t("notEnabledNotice")}</p>}
      <p style={{ margin: "0 0 12px", color: "var(--ink2)", fontSize: "0.9rem" }}>
        {t("pmNote")} <Link href="/hr/payroll/costing">{t("oldCostingLink")}</Link>
      </p>

      {canRequest && <AllocationForm projects={projects.data} costCenters={centers.data} enabled={enabled} />}

      <Card title={t("allocationsTitle")}>
        {allocations.source === "error" ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "cost allocations" })} backHref="/hr/payroll" /></div>
        ) : (
          <AllocationsTable rows={allocationRows} canDecide={canDecide} currentUserId={currentUserId} />
        )}
      </Card>

      {canSeeTotals && (
        <>
          <Card title={t("reportTitle")}>
            <div className="pad">
              <ProjectCostingRangeForm initialFrom={fromRaw} initialTo={toRaw} />
              {rangeInvalid && <p role="alert" className="pill bad" style={{ width: "fit-content" }}>{t("rangeInvalidError")}</p>}
            </div>
            {reportErrored ? (
              <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "project costing" })} backHref="/hr/payroll" /></div>
            ) : !rangeValid ? (
              <EmptyState icon="🗓️" title={t("chooseRangeTitle")} message={t("chooseRangeMessage")} />
            ) : (
              <>
                {anyHidden && <p role="note" className="pill" style={{ margin: "0 0 12px", width: "fit-content" }}>{t("suppressedNotice", { n: minCohort })}</p>}
                <StatGrid>
                  <StatCard icon="📁" iconBg="var(--infobg)" label={t("statProjects")} value={new Set(projectRows.filter((r) => !r.hidden).map((r) => r.project)).size} />
                  <StatCard icon="₹" iconBg="var(--warnbg)" label={t("statGross")} value={formatMoney(sumVisible("gross"))} />
                  <StatCard icon="₹" iconBg="var(--goodbg)" label={t("statTotal")} value={formatMoney(sumVisible("total"))} />
                </StatGrid>
                <DataTable<Row>
                  columns={[
                    { key: "period", label: t("colPeriod") }, { key: "project", label: t("colProject") },
                    { key: "gross", label: t("colGross"), align: "right" },
                    { key: "employer", label: t("colEmployer"), align: "right" },
                    { key: "total", label: t("colTotal"), align: "right" },
                    { key: "headcount", label: t("colHeadcount"), align: "right" },
                  ]}
                  rows={projectRows.map((r) => ({ ...r, gross: showMoney(r.gross, r.hidden), employer: showMoney(r.employer, r.hidden), total: showMoney(r.total, r.hidden), headcount: r.hidden ? "—" : r.headcount }))} sortable filterable filterPlaceholder={t("filterPlaceholder")} pageSize={15}
                  emptyIcon="📊" emptyTitle={t("reportEmptyTitle")} emptyMessage={t("reportEmptyMessage")}
                />
              </>
            )}
          </Card>
          {rangeValid && !reportErrored && (
            <Card title={t("byCostCenterTitle")}>
              <DataTable<Row>
                columns={[
                  { key: "period", label: t("colPeriod") }, { key: "costCenter", label: t("colCostCenter") },
                  { key: "gross", label: t("colGross"), align: "right" },
                  { key: "employer", label: t("colEmployer"), align: "right" },
                  { key: "total", label: t("colTotal"), align: "right" },
                  { key: "headcount", label: t("colHeadcount"), align: "right" },
                ]}
                rows={ccRows.map((r) => ({ ...r, gross: showMoney(r.gross, r.hidden), employer: showMoney(r.employer, r.hidden), total: showMoney(r.total, r.hidden), headcount: r.hidden ? "—" : r.headcount }))} sortable pageSize={15}
                emptyIcon="🏢" emptyTitle={t("reportEmptyTitle")} emptyMessage={t("reportEmptyMessage")}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
