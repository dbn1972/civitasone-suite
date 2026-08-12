import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
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
  const overdue = items.filter((r) => r.dueDate && r.dueDate < today).length;
  const dueSoon = items.filter((r) => {
    if (!r.dueDate || r.dueDate < today) return false;
    const diff = Math.ceil((new Date(r.dueDate).getTime() - Date.now()) / 86_400_000);
    return diff <= 30;
  }).length;

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
      <PageHeader
        title="Probation Confirmations"
        subtitle="Employees due for service confirmation after the mandatory probation period (2 years for Central Government services)."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="On Probation" value={items.length} />
        <StatCard icon="⏰" iconBg="#fff1f0" label="Overdue" value={overdue} />
        <StatCard icon="📅" iconBg="#fffbe6" label="Due in 30 Days" value={dueSoon} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Timely" value={Math.max(0, items.length - overdue - dueSoon)} />
      </StatGrid>
      <Card title="Probation Register">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee or department…"
          pageSize={15}
          emptyIcon="📋"
          emptyTitle="No employees on probation"
          emptyMessage="Employees in their probation period appear here. The system tracks confirmation due dates and flags overdue cases for HR action."
        />
      </Card>
    </main>
  );
}
