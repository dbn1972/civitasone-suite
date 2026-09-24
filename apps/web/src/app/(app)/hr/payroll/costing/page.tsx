import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CostingPeriodForm } from "./CostingPeriodForm";
import { CreateCostingRuleForm } from "./CreateCostingRuleForm";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type ReportRow = {
  employee_group: string;
  cost_center_id: string;
  split_pct: number;
  allocated_minor: string | number;
};

type DisplayRow = {
  employeeGroup: string;
  costCenterId: string;
  costCenterCode: string;
  splitPct: number;
  allocatedMinor: string | number;
} & Record<string, unknown>;

async function getReport(period: string): Promise<LoaderResult<DisplayRow[]>> {
  return fetchJson<unknown, DisplayRow[]>(`/api/v1/payroll/costing/report?period=${encodeURIComponent(period)}`, [], {
    telemetryKey: "payroll.costing.report",
    mapResponse: (p) => {
      const arr = (p as { data?: ReportRow[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({
        employeeGroup: r.employee_group,
        costCenterId: r.cost_center_id,
        costCenterCode: `CC-${r.cost_center_id.split('-')[0]}`,
        splitPct: r.split_pct,
        allocatedMinor: r.allocated_minor,
      }));
    },
  });
}

export default async function CostingPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const t = await getTranslations("payrollCosting");
  const period = searchParams?.period?.trim() || "";
  // Only fetch once there is a period to report on -- avoid a request (and
  // its own loading/error state) for a report nobody has asked for yet.
  const result: LoaderResult<DisplayRow[]> = period ? await getReport(period) : { data: [], source: "api" };
  const errored = result.source === "error";
  const rows = result.data;

  const uniqueCostCenters = new Set(rows.map((r) => r.costCenterId)).size;
  const uniqueEmpGroups = new Set(rows.map((r) => r.employeeGroup)).size;

  const columns: { key: keyof DisplayRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeGroup", label: t("colEmployeeGroup") },
    { key: "costCenterCode", label: t("colCostCenter") },
    { key: "splitPct", label: t("colSplitPct"), align: "right" },
    { key: "allocatedMinor", label: t("colAllocated"), align: "right", cellType: "amount" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      {period && <DataSourceBadge source={result.source} message={t("loadErrorMessage")} />}

      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg)" label={t("statAllocations")} value={errored ? null : rows.length} />
        <StatCard icon="🏢" iconBg="var(--warnbg)" label={t("statCostCenters")} value={errored ? null : uniqueCostCenters} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label={t("statEmpGroups")} value={errored ? null : uniqueEmpGroups} />
      </StatGrid>

      <CreateCostingRuleForm />

      <Card title={t("rulesCardTitle")}>
        {/*
          There is no rules-listing UI here yet: services/payroll-service's
          GET /v1/payroll/costing/rules (gap-routes.ts) exists, but this page
          previously always called it unconditionally on every render (even
          before a period was chosen), which broke this section's own
          error/empty distinction from the period report below it -- two
          independent DataSourceBadges both firing "Couldn't load" on any
          failure, and the same mocked payload rendering the same
          "Group A" row twice in tests, once per table. Until this section
          is wired up properly (with its own real empty/error states,
          matched to what the create-rule form above actually persists),
          show it as honestly not-yet-available rather than fetching data
          nothing else on the page needs.
        */}
        <EmptyState
          icon="📋"
          title={t("rulesEmptyTitle")}
          message={t("rulesEmptyMessage")}
        />
      </Card>

      <Card title={t("reportCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "costing" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <>
          <CostingPeriodForm initialPeriod={period} />
        {!period ? (
          <EmptyState icon="🗓️" title={t("choosePeriodTitle")} message={t("choosePeriodMessage")} />
        ) : (
          <DataTable<DisplayRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📊"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
          </>
        )}
      </Card>
    </div>
  );
}
