import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  category: string;
  amount: string;
  claimDate: string;
  description: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/expenses", [], {
    telemetryKey: "hr.expenses",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function ExpensesPage() {
  const items = await getData();

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "category", label: "Category" },
    { key: "amount", label: "Amount" },
    { key: "description", label: "Description" },
    { key: "claimDate", label: "Claim Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Expense Claims" subtitle="Employee expense claims with approval tracking." back="/hr" />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e6f0ff" label="Total Claims" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Rejected" value={rejected} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Expense Claims</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, category or status…" pageSize={15} />
      </div>
    </main>
  );
}
