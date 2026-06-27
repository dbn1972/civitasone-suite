import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function FeesPage() {
  type Row = { feeType: string; payer: string; amount: string; date: string; receiptNo: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { feeType: "Building Plan Approval", payer: "Sunrise Developers Pvt Ltd", amount: "₹3,50,000", date: "15-Jan-2025", receiptNo: "FEE/2025/0012", status: "approved" },
    { feeType: "Trade License Renewal", payer: "M/s Gupta & Sons", amount: "₹25,000", date: "14-Jan-2025", receiptNo: "FEE/2025/0011", status: "approved" },
    { feeType: "Water Connection", payer: "Rajesh Sharma", amount: "₹8,500", date: "13-Jan-2025", receiptNo: "FEE/2025/0010", status: "approved" },
    { feeType: "Encumbrance Certificate", payer: "Priya Verma", amount: "₹1,200", date: "12-Jan-2025", receiptNo: "FEE/2025/0009", status: "approved" },
    { feeType: "Building Completion", payer: "L&T Realty Ltd", amount: "₹5,00,000", date: "11-Jan-2025", receiptNo: "FEE/2025/0008", status: "pending" },
    { feeType: "NOC Fee", payer: "Metro Constructions", amount: "₹75,000", date: "10-Jan-2025", receiptNo: "FEE/2025/0007", status: "approved" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Fees Collection" subtitle="Statutory fees, service charges, and application fee collection register." back="/finance" />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e7edfd" label="Collections (MTD)" value="₹42.5 L" />
        <StatCard icon="📋" iconBg="#ecfdf3" label="Receipts Issued" value={234} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Fee Types" value={18} />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Pending" value={12} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Fee Collections</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🧾" title="No collections" message="No fee collections found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "feeType", label: "Fee Type" },
              { key: "payer", label: "Payer" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "date", label: "Date" },
              { key: "receiptNo", label: "Receipt No" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
