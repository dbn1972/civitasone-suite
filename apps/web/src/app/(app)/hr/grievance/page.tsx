import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  category: string;
  filedDate: string;
  assignedTo: string;
  description: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/grievances", [], {
    telemetryKey: "hr.grievances",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function GrievancePage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "id", label: "Case ID" },
    { key: "employee", label: "Employee" },
    { key: "category", label: "Category" },
    { key: "filedDate", label: "Filed Date" },
    { key: "assignedTo", label: "Assigned To" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Grievance Redressal" subtitle="Employee grievances, category tracking, and resolution status." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="Grievance Cases">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, category or assigned officer…"
          pageSize={15}
          emptyIcon="📋"
          emptyTitle="No grievances filed"
          emptyMessage="Grievance cases appear here when employees raise formal complaints. Cases are assigned to an HR officer and tracked to resolution."
        />
      </Card>
    </main>
  );
}
