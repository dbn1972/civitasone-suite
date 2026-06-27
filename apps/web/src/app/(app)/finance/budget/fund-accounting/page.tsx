import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function FundAccountingPage() {
  type Row = { fundCode: string; name: string; receipts: string; expenditure: string; balance: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { fundCode: "CF-01", name: "Consolidated Fund", receipts: "₹4,500 Cr", expenditure: "₹3,890 Cr", balance: "₹610 Cr", status: "active" },
    { fundCode: "CF-02", name: "Contingency Fund", receipts: "₹50 Cr", expenditure: "₹12 Cr", balance: "₹38 Cr", status: "active" },
    { fundCode: "PA-01", name: "Public Account — Deposits", receipts: "₹280 Cr", expenditure: "₹195 Cr", balance: "₹85 Cr", status: "active" },
    { fundCode: "PA-02", name: "Public Account — Remittances", receipts: "₹420 Cr", expenditure: "₹410 Cr", balance: "₹10 Cr", status: "active" },
    { fundCode: "SF-01", name: "State Disaster Response Fund", receipts: "₹180 Cr", expenditure: "₹92 Cr", balance: "₹88 Cr", status: "active" },
    { fundCode: "SF-02", name: "Local Body Grants Fund", receipts: "₹350 Cr", expenditure: "₹298 Cr", balance: "₹52 Cr", status: "active" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Fund-wise Accounting" subtitle="Receipts, expenditure, and balance position across government funds." back="/finance" />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Active Funds" value={12} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Receipts" value="₹5,780 Cr" />
        <StatCard icon="📤" iconBg="#fce7ee" label="Total Expenditure" value="₹4,897 Cr" />
        <StatCard icon="₹" iconBg="#fffaeb" label="Net Balance" value="₹883 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Fund Accounts</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🏛️" title="No data" message="No fund accounting data available." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "fundCode", label: "Fund Code" },
              { key: "name", label: "Fund Name" },
              { key: "receipts", label: "Receipts", align: "right" },
              { key: "expenditure", label: "Expenditure", align: "right" },
              { key: "balance", label: "Balance", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
