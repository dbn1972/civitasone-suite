import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function DepositsPage() {
  type Row = { fdNo: string; bank: string; amount: string; maturityDate: string; rate: string; tenure: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { fdNo: "FD/SBI/2024/001", bank: "SBI", amount: "₹5,00,00,000", maturityDate: "30-Jun-2025", rate: "7.25%", tenure: "1 Year", status: "active" },
    { fdNo: "FD/PNB/2024/012", bank: "PNB", amount: "₹3,50,00,000", maturityDate: "15-Mar-2025", rate: "7.10%", tenure: "9 Months", status: "active" },
    { fdNo: "FD/BOB/2024/008", bank: "BOB", amount: "₹2,00,00,000", maturityDate: "01-Sep-2025", rate: "7.35%", tenure: "18 Months", status: "active" },
    { fdNo: "FD/UNION/2024/003", bank: "Union Bank", amount: "₹8,00,00,000", maturityDate: "22-Dec-2025", rate: "7.50%", tenure: "2 Years", status: "active" },
    { fdNo: "FD/SBI/2023/045", bank: "SBI", amount: "₹4,50,00,000", maturityDate: "10-Feb-2025", rate: "6.80%", tenure: "1 Year", status: "overdue" },
    { fdNo: "FD/PNB/2024/019", bank: "PNB", amount: "₹1,75,00,000", maturityDate: "28-Apr-2025", rate: "7.00%", tenure: "6 Months", status: "active" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Fixed & Term Deposits" subtitle="Manage fixed deposits and term deposits across treasury banks." back="/finance" />
      <StatGrid>
        <StatCard icon="🏦" iconBg="#e7edfd" label="Total FDs" value={28} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="Total Invested" value="₹24.75 Cr" />
        <StatCard icon="📈" iconBg="#fffaeb" label="Avg. Rate" value="7.17%" />
        <StatCard icon="📅" iconBg="#fce7ee" label="Maturing (30d)" value={3} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Fixed Deposits</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🏦" title="No deposits" message="No fixed or term deposits found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "fdNo", label: "FD No" },
              { key: "bank", label: "Bank" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "maturityDate", label: "Maturity Date" },
              { key: "rate", label: "Rate", align: "right" },
              { key: "tenure", label: "Tenure" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
