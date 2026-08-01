import { PageHeader, Card, DataTable, EmptyState } from "../../../../_components/ds";
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
  const result: LoaderResult<DisplayRow[]> = period ? await getReport(period) : { data: [], source: "api" };
  const rows = result.data;

  const columns: { key: keyof DisplayRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeGroup", label: "Employee Group" },
    { key: "costCenterId", label: "Cost Center" },
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
      {period && result.source === "error" && <DataSourceBadge source="error" />}

      <CreateCostingRuleForm />

      <Card title="Costing Rules">
        <EmptyState
          icon="📋"
          title="Rules list not yet available"
          message="The payroll-service does not currently expose a GET /v1/payroll/costing/rules listing endpoint — only rule creation (POST) exists. Use the form above to add or update a rule; it will be reflected in the costing report below."
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
