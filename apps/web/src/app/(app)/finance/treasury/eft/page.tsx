import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function EftPage() {
  type Row = { beneficiary: string; ifsc: string; amount: string; utrNo: string; status: string; date: string; [k: string]: unknown };
  const rows: Row[] = [
    { beneficiary: "M/s Tata Projects Ltd", ifsc: "SBIN0001234", amount: "₹18,50,000", utrNo: "SBIN225012345678", status: "cleared", date: "15-Jan-2025" },
    { beneficiary: "Bharat Electronics Ltd", ifsc: "PUNB0123456", amount: "₹9,25,000", utrNo: "PUNB225098765432", status: "cleared", date: "14-Jan-2025" },
    { beneficiary: "HCL Infosystems Ltd", ifsc: "BARB0DELHIN", amount: "₹4,80,000", utrNo: "BARB225045678901", status: "pending", date: "13-Jan-2025" },
    { beneficiary: "NBCC India Ltd", ifsc: "UBIN0534218", amount: "₹56,00,000", utrNo: "UBIN225012349876", status: "cleared", date: "12-Jan-2025" },
    { beneficiary: "Wipro Infrastructure", ifsc: "SBIN0009876", amount: "₹22,00,000", utrNo: "SBIN225067891234", status: "rejected", date: "11-Jan-2025" },
    { beneficiary: "L&T Construction", ifsc: "PUNB0987654", amount: "₹1,05,00,000", utrNo: "—", status: "pending", date: "10-Jan-2025" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Electronic Fund Transfer" subtitle="NEFT/RTGS transfers with UTR tracking and beneficiary verification." back="/finance" />
      <StatGrid>
        <StatCard icon="⚡" iconBg="#e7edfd" label="Total Transfers" value={234} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Cleared" value={198} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={28} />
        <StatCard icon="₹" iconBg="#eff6ff" label="Total Value" value="₹14.2 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>EFT Transactions</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="⚡" title="No transfers" message="No electronic fund transfers found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "beneficiary", label: "Beneficiary" },
              { key: "ifsc", label: "IFSC" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "utrNo", label: "UTR No" },
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
