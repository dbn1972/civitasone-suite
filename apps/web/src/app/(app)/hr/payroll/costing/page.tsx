import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import type { LoaderResult } from "@/app/_data/apiClient";
import { CostingPeriodForm } from "./CostingPeriodForm";
import { CreateCostingRuleForm } from "./CreateCostingRuleForm";
import { CostingRulesTable, type RuleRow } from "./CostingRulesTable";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { parsePeriodParam } from "@/lib/payroll/period";
import { getTranslations } from "next-intl/server";
import {
  costCenterLabel,
  formatSplitPct,
  getCostCenters,
  getReport,
  getRules,
  groupTotals,
  type CostCenterOption,
  type ReportRow,
} from "./costingData";

type DisplayRow = {
  id: string;
  employeeGroup: string;
  costCenterLabel: string;
  splitPctLabel: string;
  allocatedMinor: string | null;
} & Record<string, unknown>;

export default async function CostingPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const t = await getTranslations("payrollCosting");

  // GAP-PAYROLL-COSTING-05: hr/layout.tsx admits employee/manager. The
  // costing GETs are READER_ROLES and the rule POST is PAYROLL_ROLES in
  // payroll-service gap-routes.ts -- gate the page and the form to match.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="cost allocation" requiredRoles={PAYROLL_READER_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  // GAP-PAYROLL-COSTING-06: validate ?period= before fetching (2026-13 used
  // to be sent straight to the API).
  const periodParam = parsePeriodParam(searchParams?.period);
  const period = periodParam.state === "valid" ? periodParam.period : "";

  const [reportResult, rulesResult, centersResult] = await Promise.all([
    period ? getReport(period) : Promise.resolve<LoaderResult<ReportRow[]>>({ data: [], source: "api" }),
    getRules(),
    getCostCenters(),
  ]);
  const reportErrored = reportResult.source === "error";
  const rulesErrored = rulesResult.source === "error";
  const centersAvailable = centersResult.source !== "error";
  const centers: CostCenterOption[] = centersAvailable ? centersResult.data : [];
  const centerMap = new Map(centers.map((c) => [c.id, c]));
  const unresolved = (id: string) => t("costCenterUnresolved", { id });

  const reportRows: DisplayRow[] = reportResult.data.map((r, i) => ({
    id: `${r.employeeGroup}:${r.costCenterId ?? i}`,
    employeeGroup: r.employeeGroup,
    costCenterLabel: costCenterLabel(r.costCenterId, centerMap, unresolved).label,
    splitPctLabel: formatSplitPct(r.splitPct),
    allocatedMinor: r.allocatedMinor,
  }));

  const rules = rulesResult.data;
  const totals = groupTotals(rules);
  const ruleRows: RuleRow[] = rules.map((r) => {
    const total = totals.get(r.employeeGroup) ?? 0;
    return {
      id: r.id,
      employeeGroup: r.employeeGroup,
      costCenterLabel: costCenterLabel(r.costCenterId, centerMap, unresolved).label,
      splitPct: r.splitPct,
      splitPctLabel: formatSplitPct(r.splitPct),
      groupTotalLabel: total === 100 ? formatSplitPct(total) : t("groupTotalInvalid", { total: formatSplitPct(total) }),
      status: r.status,
    };
  });
  const invalidGroups = [...totals.entries()].filter(([, total]) => total !== 100).map(([g]) => g);

  // GAP-PAYROLL-COSTING-03: before a period is chosen the stats are unknown
  // ("—"), not real-looking zeros.
  const noReport = !period || reportErrored;
  const uniqueCostCenters = new Set(reportRows.map((r) => r.costCenterLabel)).size;
  const uniqueEmpGroups = new Set(reportRows.map((r) => r.employeeGroup)).size;

  const reportColumns: { key: keyof DisplayRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeGroup", label: t("colEmployeeGroup") },
    { key: "costCenterLabel", label: t("colCostCenter") },
    { key: "splitPctLabel", label: t("colSplitPct"), align: "right" },
    { key: "allocatedMinor", label: t("colAllocated"), align: "right", cellType: "amount" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />

      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg)" label={t("statAllocations")} value={noReport ? null : reportRows.length} />
        <StatCard icon="🏢" iconBg="var(--warnbg)" label={t("statCostCenters")} value={noReport ? null : uniqueCostCenters} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label={t("statEmpGroups")} value={noReport ? null : uniqueEmpGroups} />
      </StatGrid>

      {canAdminister && (
        <CreateCostingRuleForm costCenters={centers} costCentersAvailable={centersAvailable} rules={rules} />
      )}

      {/* GAP-PAYROLL-COSTING-02: the rules list was a hard-coded "not yet
          available" EmptyState even though GET /v1/payroll/costing/rules
          exists. It has its own error state, separate from the report. */}
      <Card title={t("rulesCardTitle")}>
        {rulesErrored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "costing rules" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <>
            {invalidGroups.length > 0 && (
              <p role="alert" className="pill warn" style={{ margin: "12px 16px 0", width: "fit-content" }}>
                {t("groupsNot100Warning", { groups: invalidGroups.join(", ") })}
              </p>
            )}
            {/* GAP-PAYROLL-COSTING-02: edit / deactivate / reactivate (payroll admins). */}
            <CostingRulesTable rows={ruleRows} rules={rules} canAdminister={canAdminister} />
          </>
        )}
      </Card>

      <Card title={t("reportCardTitle")}>
        <div className="pad">
          {/* GAP-PAYROLL-COSTING-04: the period form stays visible on a
              failed report so another period can be chosen without editing
              the URL. */}
          <CostingPeriodForm initialPeriod={period || (periodParam.state === "invalid" ? periodParam.raw : "")} />
          {periodParam.state === "invalid" && (
            <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
              {t("periodInvalidError", { value: periodParam.raw })}
            </p>
          )}
        </div>
        {reportErrored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "costing" })} backHref="/hr/payroll" />
          </div>
        ) : !period ? (
          <EmptyState icon="🗓️" title={t("choosePeriodTitle")} message={t("choosePeriodMessage")} />
        ) : (
          <DataTable<DisplayRow>
            columns={reportColumns}
            rows={reportRows}
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
