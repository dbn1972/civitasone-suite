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

type RuleRow = {
  id: string;
  employee_group: string;
  cost_center_id: string;
  split_pct: number;
  status: string;
  created_at: string;
};

type RuleDisplayRow = {
  employeeGroup: string;
  costCenterId: string;
  costCenterCode: string;
  splitPct: number;
  status: string;
} & Record<string, unknown>;

async function getRules(): Promise<LoaderResult<RuleDisplayRow[]>> {
  return fetchJson<unknown, RuleDisplayRow[]>("/api/v1/payroll/costing/rules", [], {
    telemetryKey: "payroll.costing.rules",
    mapResponse: (p) => {
      const arr = (p as { data?: RuleRow[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({
        employeeGroup: r.employee_group,
        costCenterId: r.cost_center_id,
        costCenterCode: `CC-${r.cost_center_id.split('-')[0]}`,
        splitPct: r.split_pct,
        status: r.status,
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

  const rulesResult = await getRules();
  const ruleRows = rulesResult.data;

  const columns: { key: keyof DisplayRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "employeeGroup", label: "Employee Group" },
    { key: "costCenterCode", label: "Cost Center" },
    { key: "splitPct", label: "Split %", align: "right" },
    { key: "allocatedMinor", label: "Allocated Amount", align: "right", cellType: "amount" },
  ];

  const ruleColumns: { key: keyof RuleDisplayRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "employeeGroup", label: "Employee Group" },
    { key: "costCenterCode", label: "Cost Center" },
    { key: "splitPct", label: "Split %", align: "right" },
    { key: "status", label: "Status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Cost Allocation"
        subtitle="Define cost-center allocation rules and view the monthly costing report."
        back="/hr/payroll"
      />
      {period && <DataSourceBadge source={result.source} />}
      <DataSourceBadge source={rulesResult.source} />

      <CreateCostingRuleForm />

      <Card title="Costing Rules">
        <DataTable<RuleDisplayRow>
          columns={ruleColumns}
          rows={ruleRows}
          sortable
          filterable
          filterPlaceholder="Filter by employee group…"
          pageSize={15}
          emptyIcon="📋"
          emptyTitle="No costing rules yet"
          emptyMessage="Use the form above to add a cost-center allocation rule."
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
