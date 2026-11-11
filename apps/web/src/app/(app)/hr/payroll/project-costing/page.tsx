import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import type { LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { isValidPeriod } from "@/lib/payroll/period";
import { formatMoney } from "@/lib/formatters";
import { employeeDisplayLabel, resolveEmployeeNames } from "@/app/_data/employeeNames";
import { AllocationForm } from "./AllocationForm";
import { AllocationDecisionButtons } from "./AllocationDecisionButtons";
import { ProjectCostingRangeForm } from "./ProjectCostingRangeForm";
import {
  PROJECT_COSTING_APPROVE_ROLES, PROJECT_COSTING_TOTALS_ROLES, PROJECT_COSTING_VIEW_ROLES, PROJECT_COSTING_WRITE_ROLES,
  getAllocations, getByCostCenter, getByProject, getCostCenters, getProjectIndex, getSettings, shortId,
  type CostCenterCostRow, type ProjectCostRow, type UnallocatedRow,
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
    canSeeTotals && rangeValid ? getByProject(fromRaw, toRaw) : empty<ProjectCostRow[]>([]),
    canSeeTotals && rangeValid ? getByCostCenter(fromRaw, toRaw) : empty<{ data: CostCenterCostRow[]; unallocated: UnallocatedRow[] }>({ data: [], unallocated: [] }),
  ]);
  const names = await resolveEmployeeNames(allocations.data.map((a) => a.employeeId));
  const projectMap = new Map(projects.data.map((p) => [p.projectId, p]));
  const centerMap = new Map(centers.data.map((c) => [c.id, c]));
  const projectLabel = (id: string | null) => { if (!id) return "—"; const p = projectMap.get(id); return p ? `${p.code} — ${p.name}` : t("unresolved", { id: shortId(id) }); };
  const centerLabel = (id: string) => { const c = centerMap.get(id); return c ? `${c.code} — ${c.name}` : t("unresolved", { id: shortId(id) }); };
  const personLabel = (id: string) => employeeDisplayLabel(names, id, shortId(id));
  const enabled = settings.data.enabled;

  const projectRows: Row[] = byProject.data.map((r) => ({
    id: `${r.period}:${r.projectId}`, period: r.period, project: projectLabel(r.projectId), gross: r.grossMinor, employer: r.employerCostMinor, total: r.totalCostMinor, headcount: r.headcount,
  }));
  const ccRows: Row[] = [
    ...byCc.data.data.map((r) => ({ id: `${r.period}:${r.costCenterId}`, period: r.period, costCenter: centerLabel(r.costCenterId), gross: r.grossMinor, employer: r.employerCostMinor, total: r.totalCostMinor, headcount: r.headcount })),
    ...byCc.data.unallocated.map((r) => ({ id: `${r.period}:unallocated`, period: r.period, costCenter: t("unallocatedRow"), gross: r.grossMinor, employer: r.employerCostMinor, total: r.totalCostMinor, headcount: r.headcount })),
  ];
  const sum = (k: keyof ProjectCostRow) => projectRows.reduce((s, r) => s + BigInt(String(r[k === "grossMinor" ? "gross" : k === "employerCostMinor" ? "employer" : "total"])), 0n);
  const reportErrored = byProject.source === "error" || byCc.source === "error";
  const allocationRows: Row[] = allocations.data.map((a) => ({
    id: a.id, person: personLabel(a.employeeId), target: a.targetType === "project" ? projectLabel(a.projectId) : centerLabel(a.costCenterId),
    pct: `${Number(a.splitPct)}%`, window: `${a.effectiveFrom} → ${a.effectiveTo ?? t("openEnded")}`, status: t(`status_${a.status}`),
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
          allocations.data.length === 0 ? (
            <EmptyState icon="🧮" title={t("allocationsEmptyTitle")} message={t("allocationsEmptyMessage")} />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <caption className="sr-only">{t("allocationsTitle")}</caption>
                <thead>
                  <tr>
                    {[t("colEmployee"), t("colTarget"), t("colPct"), t("colWindow"), t("colStatus")].map((c) => <th key={c} scope="col">{c}</th>)}
                    {canDecide && <th scope="col">{t("colActions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {allocationRows.map((r, i) => {
                    const a = allocations.data[i]!;
                    return (
                      <tr key={a.id}>
                        <td>{String(r.person)}</td><td>{String(r.target)}</td><td style={{ textAlign: "right" }}>{String(r.pct)}</td>
                        <td>{String(r.window)}</td><td>{String(r.status)}</td>
                        {canDecide && (
                          <td>
                            {a.status === "pending" && (
                              <AllocationDecisionButtons allocationId={a.id} requestedBy={a.requestedBy} currentUserId={currentUserId} label={`${personLabel(a.employeeId)} ${Number(a.splitPct)}%`} />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
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
                <StatGrid>
                  <StatCard icon="📁" iconBg="var(--infobg)" label={t("statProjects")} value={new Set(projectRows.map((r) => r.project)).size} />
                  <StatCard icon="₹" iconBg="var(--warnbg)" label={t("statGross")} value={formatMoney(sum("grossMinor"))} />
                  <StatCard icon="₹" iconBg="var(--goodbg)" label={t("statTotal")} value={formatMoney(sum("totalCostMinor"))} />
                </StatGrid>
                <DataTable<Row>
                  columns={[
                    { key: "period", label: t("colPeriod") }, { key: "project", label: t("colProject") },
                    { key: "gross", label: t("colGross"), align: "right", cellType: "amount" },
                    { key: "employer", label: t("colEmployer"), align: "right", cellType: "amount" },
                    { key: "total", label: t("colTotal"), align: "right", cellType: "amount" },
                    { key: "headcount", label: t("colHeadcount"), align: "right" },
                  ]}
                  rows={projectRows} sortable filterable filterPlaceholder={t("filterPlaceholder")} pageSize={15}
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
                  { key: "gross", label: t("colGross"), align: "right", cellType: "amount" },
                  { key: "employer", label: t("colEmployer"), align: "right", cellType: "amount" },
                  { key: "total", label: t("colTotal"), align: "right", cellType: "amount" },
                  { key: "headcount", label: t("colHeadcount"), align: "right" },
                ]}
                rows={ccRows} sortable pageSize={15}
                emptyIcon="🏢" emptyTitle={t("reportEmptyTitle")} emptyMessage={t("reportEmptyMessage")}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
