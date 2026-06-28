import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type ApiAdvance = {
  id: string;
  employeeId: string;
  employeeName?: string;
  department?: string;
  amountMinor: number;
  purpose: string;
  recoveryMonths: number;
  emiMinor: number;
  recoveredMinor: number;
  requestDate?: string;
  status: string;
};

type Row = {
  id: string;
  employee: string;
  department: string;
  amount: string;
  purpose: string;
  requestDate: string;
  recoverySchedule: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number): string {
  if (!minor && minor !== 0) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapAdvances(apiAdvances: ApiAdvance[]): Row[] {
  return apiAdvances.map((a) => ({
    id: a.id,
    employee: a.employeeName ?? a.employeeId,
    department: a.department ?? "—",
    amount: formatINR(a.amountMinor),
    purpose: a.purpose ?? "—",
    requestDate: a.requestDate ?? "—",
    recoverySchedule: a.recoveryMonths ? `${a.recoveryMonths} instalments` : "—",
    status: a.status,
  }));
}

async function getAdvances(): Promise<Row[]> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/salary-advances", [], {
    telemetryKey: "hr.advances",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiAdvance[] })?.data;
      return Array.isArray(arr) ? mapAdvances(arr as ApiAdvance[]) : null;
    },
  });
  return res.data;
}

export default async function AdvancesPage() {
  const items = await getAdvances();

  const active = items.filter((i) => i.status === "active" || i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const totalDisbursed = items.length > 0
    ? `${items.length} advances`
    : "—";

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "amount", label: "Amount" },
    { key: "purpose", label: "Purpose" },
    { key: "requestDate", label: "Request Date" },
    { key: "recoverySchedule", label: "Recovery" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Salary Advances" subtitle="Employee salary advance requests and recovery schedules." back="/hr" />
      <StatGrid>
        <StatCard icon="💸" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="▶️" iconBg="#e6f7f0" label="Active Recovery" value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="💰" iconBg="#f5f5f5" label="Total Disbursed" value={totalDisbursed} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Advances Register</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable exportable
        filterPlaceholder="Filter by employee or purpose…" pageSize={15} />
      </div>
    </main>
  );
}
