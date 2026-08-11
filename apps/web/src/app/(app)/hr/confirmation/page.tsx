import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  joiningDate: string;
  probationEnd: string;
  dueDate: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/confirmations", [], {
    telemetryKey: "hr.confirmations",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ConfirmationPage() {
  const { data: items, source } = await getData();
  const today = new Date().toISOString().slice(0, 10);
  const overdue = items.filter((r) => r.dueDate && r.dueDate < today && r.status !== "confirmed").length;
  const pending = items.filter((r) => r.status === "probation" || r.status === "pending").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "joiningDate", label: "Joining Date" },
    { key: "probationEnd", label: "Probation Ends" },
    { key: "dueDate", label: "Confirmation Due" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Probation Confirmations" subtitle="Employees due for confirmation after probation period." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
        <StatCard icon="⏰" iconBg="#fff0e6" label="Overdue" value={overdue} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or department…" pageSize={15} />
      </div>
    </main>
  );
}
