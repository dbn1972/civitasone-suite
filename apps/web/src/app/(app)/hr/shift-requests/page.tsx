import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  currentShift: string;
  requestedShift: string;
  effectiveDate: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/shift-requests", [], {
    telemetryKey: "hr.shift-requests",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function ShiftRequestsPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "currentShift", label: "Current Shift" },
    { key: "requestedShift", label: "Requested Shift" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "reason", label: "Reason" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Shift Change Requests" subtitle="Employee requests to change assigned shifts." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="Shift Change Requests">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, shift or department…"
          pageSize={15}
          emptyIcon="🔄"
          emptyTitle="No shift change requests"
          emptyMessage="Requests appear here when employees apply to change their assigned shift. Approved by reporting officers."
        />
      </Card>
    </main>
  );
}
