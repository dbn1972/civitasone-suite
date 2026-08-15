import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { LoanSummaryCard, type LoanRecord, type LoanType } from "./LoanSummaryCard";

const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  hba: "House Building Advance",
  vehicle: "Vehicle Loan",
  computer: "Computer Advance",
  festival: "Festival Advance",
};

async function getLoans() {
  return fetchJson<LoanRecord[], LoanRecord[]>("/api/v1/finance/loans", [] as LoanRecord[], {
    revalidateSeconds: 60,
    telemetryKey: "finance.loans",
    mapResponse: (d) => (Array.isArray(d) ? d : []),
  });
}

type LoanTableRow = {
  id: string;
  employee: string;
  loanType: string;
  sanctionedDisplay: string;
  outstandingDisplay: string;
  emiDisplay: string;
  nextDue: string;
  status: string;
};

export default async function LoansPage() {
  const { data: loans, source } = await getLoans();

  const activeLoans = loans.filter((l) => l.status === "active").length;
  const overdueLoans = loans.filter((l) => l.status === "overdue").length;
  const totalOutstanding = loans.reduce((s, l) => s + (l.outstandingBalance ?? 0), 0);
  const totalOutstandingDisplay = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(totalOutstanding);
  const hbaCount = loans.filter((l) => l.loanType === "hba").length;

  // My loans (first 4 for summary cards)
  const summaryLoans = loans.slice(0, 4);

  const tableRows: LoanTableRow[] = loans.map((l) => ({
    id: l.id,
    employee: `${l.employeeName} (${l.employeeCode})`,
    loanType: LOAN_TYPE_LABELS[l.loanType] ?? l.loanType,
    sanctionedDisplay: new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: l.currency ?? "INR",
      maximumFractionDigits: 0,
    }).format(l.sanctionedAmount),
    outstandingDisplay: new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: l.currency ?? "INR",
      maximumFractionDigits: 0,
    }).format(l.outstandingBalance),
    emiDisplay: new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: l.currency ?? "INR",
      maximumFractionDigits: 0,
    }).format(l.emiAmount),
    nextDue: l.nextDueDate
      ? new Date(l.nextDueDate).toLocaleDateString("en-IN")
      : "—",
    status: l.status,
  }));

  return (
    <>
      <PageHeader
        title="Loans & Advances"
        subtitle="HBA, vehicle, computer and festival advances — GFR 2017 Chapter 23. Interest rates and limits per pay level."
        actions={source === "error" ? <DataSourceBadge source={source} /> : undefined}
        help="finance-loans"
      />

      <StatGrid>
        <StatCard icon="🏠" iconBg="#e7edfd" label="HBA Accounts" value={hbaCount} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active Loans" value={activeLoans} />
        <StatCard icon="⚠" iconBg="#fef3f2" label="Overdue" value={overdueLoans} />
        <StatCard icon="💰" iconBg="#fffaeb" label="Total Outstanding" value={totalOutstandingDisplay} />
      </StatGrid>

      {summaryLoans.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
          {summaryLoans.map((loan) => (
            <LoanSummaryCard key={loan.id} loan={loan} />
          ))}
        </div>
      )}

      <Card title="All Loans & Advances">
        <DataTable<LoanTableRow>
          columns={[
            { key: "id", label: "Loan ID" },
            { key: "employee", label: "Employee" },
            { key: "loanType", label: "Type" },
            { key: "sanctionedDisplay", label: "Sanctioned", align: "right" },
            { key: "outstandingDisplay", label: "Outstanding", align: "right" },
            { key: "emiDisplay", label: "EMI", align: "right" },
            { key: "nextDue", label: "Next Due" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Search loans..."
          pageSize={15}
          emptyIcon="💳"
          emptyTitle="No loans on record"
          emptyMessage="No loan or advance accounts found for this organisation."
        />
      </Card>

      <Card title="GFR 2017 Chapter 23 — Quick Reference" padding>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="font-medium">House Building Advance (HBA)</dt>
            <dd className="text-gray-600 mt-1">Max 34 months basic pay or cost of house, whichever is less. Interest per Schedule.</dd>
          </div>
          <div>
            <dt className="font-medium">Vehicle Loan</dt>
            <dd className="text-gray-600 mt-1">Motorcycle/scooter or car loan per pay level. Recoverable in up to 70 instalments.</dd>
          </div>
          <div>
            <dt className="font-medium">Computer Advance</dt>
            <dd className="text-gray-600 mt-1">Once every 5 years. Max amount and interest per government order.</dd>
          </div>
          <div>
            <dt className="font-medium">Festival Advance</dt>
            <dd className="text-gray-600 mt-1">Interest-free. Recoverable in 10 monthly instalments from salary.</dd>
          </div>
        </dl>
      </Card>
    </>
  );
}
