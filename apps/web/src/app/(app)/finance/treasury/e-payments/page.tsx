import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function EPaymentsPage() {
  type Row = { voucherNo: string; vendor: string; amount: string; bankRef: string; status: string; date: string; [k: string]: unknown };
  const rows: Row[] = [
    { voucherNo: "EP/2025/001234", vendor: "M/s Tata Projects Ltd", amount: "₹24,50,000", bankRef: "SBI-REF-20250115-001", status: "approved", date: "15-Jan-2025" },
    { voucherNo: "EP/2025/001235", vendor: "Bharat Electronics Ltd", amount: "₹8,75,000", bankRef: "PNB-REF-20250114-012", status: "issued", date: "14-Jan-2025" },
    { voucherNo: "EP/2025/001236", vendor: "HCL Infosystems Ltd", amount: "₹3,20,000", bankRef: "—", status: "pending", date: "13-Jan-2025" },
    { voucherNo: "EP/2025/001237", vendor: "NBCC India Ltd", amount: "₹67,00,000", bankRef: "BOB-REF-20250112-045", status: "approved", date: "12-Jan-2025" },
    { voucherNo: "EP/2025/001238", vendor: "Wipro Infrastructure", amount: "₹15,80,000", bankRef: "Union-REF-20250111-008", status: "rejected", date: "11-Jan-2025" },
    { voucherNo: "EP/2025/001239", vendor: "L&T Construction", amount: "₹1,42,00,000", bankRef: "SBI-REF-20250110-023", status: "approved", date: "10-Jan-2025" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="e-Payment Orders" subtitle="Electronic payment orders with voucher tracking and bank references." back="/finance" />
      <StatGrid>
        <StatCard icon="💳" iconBg="#e7edfd" label="Total Orders" value={312} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={256} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={42} />
        <StatCard icon="₹" iconBg="#eff6ff" label="Total Value" value="₹18.7 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>e-Payment Orders</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="💳" title="No orders" message="No e-payment orders found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "voucherNo", label: "Voucher No" },
              { key: "vendor", label: "Vendor" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "bankRef", label: "Bank Ref" },
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
