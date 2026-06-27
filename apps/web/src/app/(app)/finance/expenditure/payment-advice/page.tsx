import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function PaymentAdvicePage() {
  type Row = { adviceNo: string; vendor: string; amount: string; bank: string; date: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { adviceNo: "PA/2025/00123", vendor: "M/s Tata Projects Ltd", amount: "₹16,91,500", bank: "SBI", date: "15-Jan-2025", status: "issued" },
    { adviceNo: "PA/2025/00124", vendor: "Bharat Electronics Ltd", amount: "₹6,11,250", bank: "PNB", date: "14-Jan-2025", status: "issued" },
    { adviceNo: "PA/2025/00125", vendor: "HCL Infosystems Ltd", amount: "₹2,14,400", bank: "BOB", date: "13-Jan-2025", status: "pending" },
    { adviceNo: "PA/2025/00126", vendor: "NBCC India Ltd", amount: "₹48,52,000", bank: "Union Bank", date: "12-Jan-2025", status: "issued" },
    { adviceNo: "PA/2025/00127", vendor: "Wipro Infrastructure", amount: "₹10,78,600", bank: "SBI", date: "11-Jan-2025", status: "approved" },
    { adviceNo: "PA/2025/00128", vendor: "L&T Construction", amount: "₹1,02,40,000", bank: "PNB", date: "10-Jan-2025", status: "issued" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Payment Advice" subtitle="Payment advice notes issued to banks for vendor fund release." back="/finance" />
      <StatGrid>
        <StatCard icon="📝" iconBg="#e7edfd" label="Total Advices" value={189} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Issued" value={162} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={18} />
        <StatCard icon="₹" iconBg="#eff6ff" label="Total Value" value="₹28.6 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Payment Advice List</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📝" title="No records" message="No payment advice records found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "adviceNo", label: "Advice No" },
              { key: "vendor", label: "Vendor" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "bank", label: "Bank" },
              { key: "date", label: "Date" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
