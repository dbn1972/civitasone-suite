import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function PfmsPage() {
  type Row = { scrollId: string; beneficiary: string; amount: string; bankAccount: string; status: string; date: string; [k: string]: unknown };
  const rows: Row[] = [
    { scrollId: "PFMS-UP-2024-12345", beneficiary: "M/s Tata Projects Ltd", amount: "₹45,00,000", bankAccount: "SBI-1234567890", status: "approved", date: "15-Jan-2025" },
    { scrollId: "PFMS-UP-2024-12346", beneficiary: "Bharat Electronics Ltd", amount: "₹12,50,000", bankAccount: "PNB-9876543210", status: "pending", date: "14-Jan-2025" },
    { scrollId: "PFMS-UP-2024-12347", beneficiary: "HCL Infosystems Ltd", amount: "₹8,75,000", bankAccount: "BOB-5678901234", status: "approved", date: "13-Jan-2025" },
    { scrollId: "PFMS-UP-2024-12348", beneficiary: "L&T Construction", amount: "₹1,20,00,000", bankAccount: "Union Bank-3456789012", status: "rejected", date: "12-Jan-2025" },
    { scrollId: "PFMS-UP-2024-12349", beneficiary: "Wipro Infrastructure", amount: "₹32,00,000", bankAccount: "SBI-6789012345", status: "approved", date: "11-Jan-2025" },
    { scrollId: "PFMS-UP-2024-12350", beneficiary: "NBCC India Ltd", amount: "₹65,00,000", bankAccount: "PNB-2345678901", status: "pending", date: "10-Jan-2025" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="PFMS Integration" subtitle="Public Financial Management System — payment scroll tracking and beneficiary verification." back="/finance" />
      <StatGrid>
        <StatCard icon="📜" iconBg="#e7edfd" label="Total Scrolls" value={142} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={98} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={38} />
        <StatCard icon="₹" iconBg="#eff6ff" label="Total Value" value="₹28.5 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Payment Scrolls</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📜" title="No scrolls" message="No PFMS payment scrolls found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "scrollId", label: "Scroll ID" },
              { key: "beneficiary", label: "Beneficiary" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "bankAccount", label: "Bank Account" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "date", label: "Date" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
