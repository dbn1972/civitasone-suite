import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CostingPeriodForm } from "./CostingPeriodForm";
import { CreateCostingRuleForm } from "./CreateCostingRuleForm";

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
  const period = searchParams?.period?.trim() || "";
  // Only fetch once there is a period to report on -- avoid a request (and
  // its own loading/error state) for a report nobody has asked for yet.
  const result: LoaderResult<DisplayRow[]> = period ? await getReport(period) : { data: [], source: "api" };
  const rows = result.data;

  const uniqueCostCenters = new Set(rows.map((r) => r.costCenterId)).size;
  const uniqueEmpGroups = new Set(rows.map((r) => r.employeeGroup)).size;

  const columns: { key: keyof DisplayRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeGroup", label: "Employee Group" },
    { key: "costCenterCode", label: "Cost Center" },
    { key: "splitPct", label: "Split %", align: "right" },
    { key: "allocatedMinor", label: "Allocated Amount", align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Cost Allocation"
        subtitle="Define cost-center allocation rules and view the monthly costing report."
        back="/hr/payroll"
      />
      {period && <DataSourceBadge source={result.source} message="Couldn't load — showing nothing" />}

      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg)" label="Allocations (this period)" value={rows.length} />
        <StatCard icon="🏢" iconBg="var(--warnbg)" label="Cost Centers (this period)" value={uniqueCostCenters} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label="Employee Groups (this period)" value={uniqueEmpGroups} />
      </StatGrid>

      <CreateCostingRuleForm />

      <Card title="Costing Rules">
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
          title="Rules list not yet available"
          message="Use the form above to create a cost-center allocation rule; a rules list view is not wired up yet."
        />
      </Card>

      <Card title="Costing Report">
        <CostingPeriodForm initialPeriod={period} />
        {!period ? (
          <EmptyState icon="🗓️" title="Choose a period" message="Enter a period (YYYY-MM) above to view the cost allocation report." />
        ) : (
          <DataTable<DisplayRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter by employee group…"
            pageSize={15}
            emptyIcon="📊"
            emptyTitle="No allocations for this period"
            emptyMessage="No active costing rules produced allocations for this period."
          />
        )}
      </Card>
    </main>
  );
}
