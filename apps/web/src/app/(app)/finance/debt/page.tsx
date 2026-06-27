import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function DebtPage() {
  type Row = { loan: string; lender: string; outstanding: string; emi: string; nextDue: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { loan: "NABARD-RIDF-2023-045", lender: "NABARD", outstanding: "₹450 Cr", emi: "₹12.5 Cr/Qtr", nextDue: "31-Mar-2025", status: "active" },
    { loan: "HUDCO-INFRA-2022-012", lender: "HUDCO", outstanding: "₹280 Cr", emi: "₹8.2 Cr/Qtr", nextDue: "30-Jun-2025", status: "active" },
    { loan: "WB-IBRD-2021-008", lender: "World Bank (IBRD)", outstanding: "₹1,200 Cr", emi: "₹35 Cr/Half-year", nextDue: "15-Apr-2025", status: "active" },
    { loan: "ADB-LOAN-2020-003", lender: "Asian Dev. Bank", outstanding: "₹680 Cr", emi: "₹22 Cr/Half-year", nextDue: "01-May-2025", status: "active" },
    { loan: "GOI-SDRF-2024-001", lender: "Govt of India", outstanding: "₹150 Cr", emi: "₹15 Cr/Year", nextDue: "31-Mar-2025", status: "active" },
    { loan: "LIC-TERM-2019-056", lender: "LIC of India", outstanding: "₹95 Cr", emi: "₹4.5 Cr/Qtr", nextDue: "15-Feb-2025", status: "overdue" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Debt Management" subtitle="Outstanding loans, EMI schedules, and lender-wise debt position." back="/finance" />
      <StatGrid>
        <StatCard icon="🏦" iconBg="#e7edfd" label="Active Loans" value={18} />
        <StatCard icon="₹" iconBg="#fce7ee" label="Total Outstanding" value="₹2,855 Cr" />
        <StatCard icon="📅" iconBg="#fffaeb" label="Due (30d)" value={3} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Overdue" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Loan Portfolio</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🏦" title="No loans" message="No active loans found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "loan", label: "Loan ID" },
              { key: "lender", label: "Lender" },
              { key: "outstanding", label: "Outstanding", align: "right" },
              { key: "emi", label: "EMI / Instalment" },
              { key: "nextDue", label: "Next Due" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
