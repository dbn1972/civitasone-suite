import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  parentOrg: string;
  deputationOrg: string;
  fromDate: string;
  toDate: string;
  period: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/deputation", [], {
    telemetryKey: "hr.deputation",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function DeputationPage() {
  const items = await getData();

  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "parentOrg", label: "Parent Org" },
    { key: "deputationOrg", label: "Deputation To" },
    { key: "fromDate", label: "From" },
    { key: "toDate", label: "To" },
    { key: "period", label: "Period" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Deputation" subtitle="Officers on deputation to other organisations." back="/hr" />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e6f0ff" label="Total Deputations" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Completed" value={completed} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Deputation List</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or organisation…" pageSize={15} />
      </div>
    </main>
  );
}
