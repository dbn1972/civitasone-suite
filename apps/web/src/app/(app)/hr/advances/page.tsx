import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { RequestAdvanceForm } from "./RequestAdvanceForm";

type ApiAdvance = {
  id: string;
  employee?: { name?: string; employeeNo?: string };
  amountMinor: number;
  purpose: string;
  recoveryMonths: number;
  recoveredMinor?: number;
  requestDate?: string;
  status: string;
  created_at?: string;
};

type Row = {
  id: string;
  employee: string;
  amount: string;
  purpose: string;
  recoveryMonths: string;
  recovered: string;
  requestDate: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number | undefined): string {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapAdvances(rows: ApiAdvance[]): Row[] {
  return rows.map((a) => ({
    id: a.id,
    employee: a.employee?.name
      ? `${a.employee.name} (${a.employee.employeeNo ?? "—"})`
      : "—",
    amount: formatINR(a.amountMinor),
    purpose: a.purpose ?? "—",
    recoveryMonths: `${String(a.recoveryMonths).padStart(2, "0")} mo`,
    recovered: formatINR(a.recoveredMinor),
    requestDate: a.requestDate ?? a.created_at ?? "—",
    status: a.status ?? "pending",
  }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/salary-advances", [], {
    telemetryKey: "hr.advances",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiAdvance[] })?.data;
      return Array.isArray(arr) ? mapAdvances(arr as ApiAdvance[]) : null;
    },
  });
  return r;
}

export default async function AdvancesPage() {
  const { data: items, source } = await getData();

  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "amount", label: "Amount" },
    { key: "purpose", label: "Purpose" },
    { key: "recoveryMonths", label: "Recovery" },
    { key: "recovered", label: "Recovered" },
    { key: "requestDate", label: "Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Salary Advances" subtitle="Request and track salary advance disbursements." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="💰" iconBg="#e6f0ff" label="Total Advances" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
      </StatGrid>

      <RequestAdvanceForm />

      <Card title="Salary Advances">
        <div className="card-h"><h3>Advance Requests</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or status…"
          pageSize={15}
          emptyIcon="💰"
          emptyTitle="No salary advances"
          emptyMessage="Salary advance requests appear here once employees raise them. Advances are approved by HR and adjusted against subsequent salary."
        />
      </Card>
    </main>
  );
}
