import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function GuaranteesPage() {
  type Row = { type: string; party: string; amount: string; validity: string; status: string; reference: string; [k: string]: unknown };
  const rows: Row[] = [
    { type: "Bank Guarantee", party: "M/s Tata Projects Ltd", amount: "₹5,00,00,000", validity: "31-Mar-2026", status: "active", reference: "BG/SBI/2024/045" },
    { type: "Performance Security", party: "Bharat Electronics Ltd", amount: "₹1,25,00,000", validity: "30-Jun-2025", status: "active", reference: "PS/PNB/2024/012" },
    { type: "Earnest Money Deposit", party: "HCL Infosystems Ltd", amount: "₹50,00,000", validity: "28-Feb-2025", status: "active", reference: "EMD/BOB/2024/089" },
    { type: "Bank Guarantee", party: "L&T Construction", amount: "₹12,00,00,000", validity: "15-Dec-2025", status: "active", reference: "BG/UNION/2024/023" },
    { type: "Performance Security", party: "NBCC India Ltd", amount: "₹3,50,00,000", validity: "10-Jan-2025", status: "overdue", reference: "PS/SBI/2023/067" },
    { type: "Security Deposit", party: "Wipro Infrastructure", amount: "₹80,00,000", validity: "31-Mar-2025", status: "active", reference: "SD/PNB/2024/034" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Guarantees & Securities" subtitle="Bank guarantees, performance securities, and earnest money deposits." back="/finance" />
      <StatGrid>
        <StatCard icon="🛡️" iconBg="#e7edfd" label="Active Guarantees" value={48} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="Total Value" value="₹86.5 Cr" />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Expiring (30d)" value={5} />
        <StatCard icon="📅" iconBg="#fffaeb" label="Overdue" value={2} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Guarantees & Securities</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🛡️" title="No records" message="No guarantees or securities found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "type", label: "Type" },
              { key: "party", label: "Party" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "validity", label: "Valid Till" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "reference", label: "Reference" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
