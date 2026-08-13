import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type ApiLoan = {
  id: string;
  employeeId: string;
  employeeName?: string;
  department?: string;
  loanType: string;
  sanctionedAmountMinor: number;
  emiMinor: number;
  outstandingMinor: number;
  totalEmis: number;
  emisPaid: number;
  status: string;
};

type Row = {
  id: string;
  employee: string;
  department: string;
  loanType: string;
  sanctionedAmount: string;
  emi: string;
  balance: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number): string {
  if (!minor && minor !== 0) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapLoans(apiLoans: ApiLoan[]): Row[] {
  return apiLoans.map((l) => ({
    id: l.id,
    employee: l.employeeName ?? l.employeeId,
    department: l.department ?? "—",
    loanType: l.loanType,
    sanctionedAmount: formatINR(l.sanctionedAmountMinor),
    emi: l.emiMinor ? formatINR(l.emiMinor) : "—",
    balance: l.outstandingMinor != null ? formatINR(l.outstandingMinor) : "—",
    status: l.status,
  }));
}

async function getLoans(): Promise<LoaderResult<Row[]>> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/loans", [], {
    telemetryKey: "hr.loans",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiLoan[] })?.data;
      return Array.isArray(arr) ? mapLoans(arr as ApiLoan[]) : null;
    },
  });
  return res;
}

export default async function LoansPage() {
  const { data: items, source } = await getLoans();

  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed" || i.status === "closed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "loanType", label: "Loan Type" },
    { key: "sanctionedAmount", label: "Sanctioned" },
    { key: "emi", label: "EMI" },
    { key: "balance", label: "Balance" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Employee Loans" subtitle="Loans sanctioned, EMI recovery, and outstanding balances." back="/hr" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="💰" iconBg="#e6f0ff" label="Total Loans" value={items.length} />
        <StatCard icon="▶️" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#f5f5f5" label="Closed" value={completed} />
      </StatGrid>
      <Card title="Loans Register">
        <DataTable<Row> columns={columns} rows={items} sortable filterable exportable
        filterPlaceholder="Filter by employee, loan type or status…"
          pageSize={15}
          emptyIcon="💳"
          emptyTitle="No employee loans"
          emptyMessage="Employee salary advances and loans appear here. Loans are created via the Payroll › Loans module."
        />
      </Card>
    </main>
  );
}
