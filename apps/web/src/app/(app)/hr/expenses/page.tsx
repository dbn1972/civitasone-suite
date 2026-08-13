import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type ApiExpense = {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: string;
  receiptKey?: string;
  status: string;
  created_at: string;
};

type Row = {
  id: string;
  category: string;
  amount: string;
  description: string;
  date: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number): string {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapExpenses(rows: ApiExpense[]): Row[] {
  return rows.map((e) => ({
    id: e.id,
    category: e.category ?? "—",
    amount: formatINR(e.amount),
    description: e.description ?? "—",
    date: e.date ?? e.created_at ?? "—",
    status: e.status,
  }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/expenses", [], {
    telemetryKey: "hr.expenses",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiExpense[] })?.data;
      return Array.isArray(arr) ? mapExpenses(arr as ApiExpense[]) : null;
    },
  });
  return r;
}

export default async function ExpensesPage() {
  const { data: items, source } = await getData();

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "category", label: "Category" },
    { key: "amount", label: "Amount" },
    { key: "description", label: "Description" },
    { key: "date", label: "Claim Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Expense Claims" subtitle="Employee expense claims with approval tracking." back="/hr" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e6f0ff" label="Total Claims" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Rejected" value={rejected} />
      </StatGrid>
      <Card title="Expense Claims">
        <div className="card-h"><h3>Expense Claims</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by category or status…"
          pageSize={15}
          emptyIcon="🧾"
          emptyTitle="No expense claims"
          emptyMessage="Expense claims appear here once employees submit bills for travel, medical, or official expenses."
        />
      </Card>
    </main>
  );
}
