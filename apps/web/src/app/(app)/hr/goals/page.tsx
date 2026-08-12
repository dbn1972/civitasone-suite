import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  goal: string;
  kra: string;
  target: string;
  actual: string;
  cycle: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/goals", [], {
    telemetryKey: "hr.goals",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function GoalsPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "goal", label: "Goal" },
    { key: "kra", label: "KRA" },
    { key: "target", label: "Target" },
    { key: "actual", label: "Actual" },
    { key: "cycle", label: "Cycle" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Goals & KRAs" subtitle="Performance goals for current appraisal cycle with targets and actuals." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="Goals & KRAs">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, objective or cycle…" pageSize={15} emptyIcon="🎯" emptyTitle="No goals set" emptyMessage="Goals and KRAs are set during the appraisal cycle. Create an appraisal from the Appraisals page to assign objectives and targets to employees." />
      </Card>
    </main>
  );
}
