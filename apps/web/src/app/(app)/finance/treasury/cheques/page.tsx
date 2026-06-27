import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function ChequesPage() {
  type Row = { id: string; chequeNo: string; date: string; payee: string; amount: string; bank: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { id: "chq-001", chequeNo: "123456", date: "15-Jan-2025", payee: "M/s Tata Projects Ltd", amount: "₹12,50,000", bank: "SBI", status: "cleared" },
    { id: "chq-002", chequeNo: "123457", date: "14-Jan-2025", payee: "Bharat Electronics Ltd", amount: "₹5,80,000", bank: "PNB", status: "cleared" },
    { id: "chq-003", chequeNo: "123458", date: "13-Jan-2025", payee: "HCL Infosystems Ltd", amount: "₹2,45,000", bank: "BOB", status: "pending" },
    { id: "chq-004", chequeNo: "123459", date: "12-Jan-2025", payee: "NBCC India Ltd", amount: "₹34,00,000", bank: "Union Bank", status: "cleared" },
    { id: "chq-005", chequeNo: "123460", date: "11-Jan-2025", payee: "Wipro Infrastructure", amount: "₹8,90,000", bank: "SBI", status: "issued" },
    { id: "chq-006", chequeNo: "123461", date: "10-Jan-2025", payee: "L&T Construction", amount: "₹76,00,000", bank: "PNB", status: "pending" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Cheque / DD Register" subtitle="Cheque and Demand Draft register with clearance tracking." back="/finance" />
      <StatGrid>
        <StatCard icon="📝" iconBg="#e7edfd" label="Total Cheques" value={186} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Cleared" value={142} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={32} />
        <StatCard icon="₹" iconBg="#eff6ff" label="Total Value" value="₹8.4 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Cheques & Demand Drafts</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📝" title="No cheques" message="No cheques or demand drafts found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "chequeNo", label: "Cheque No" },
              { key: "date", label: "Date" },
              { key: "payee", label: "Payee" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "bank", label: "Bank" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/finance/treasury/cheques/"
          />
        )}
      </div>
    </main>
  );
}
