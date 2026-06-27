import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function ReceiptsPage() {
  type Row = { receiptNo: string; payer: string; head: string; amount: string; mode: string; date: string; [k: string]: unknown };
  const rows: Row[] = [
    { receiptNo: "RV/2025/0234", payer: "Rajesh Sharma", head: "0030-Stamps & Registration", amount: "₹2,50,000", mode: "NEFT", date: "15-Jan-2025" },
    { receiptNo: "RV/2025/0233", payer: "Municipal Corporation", head: "0041-Taxes on Vehicles", amount: "₹18,50,000", mode: "RTGS", date: "14-Jan-2025" },
    { receiptNo: "RV/2025/0232", payer: "Sunrise Developers Pvt Ltd", head: "0035-Taxes on Property", amount: "₹45,00,000", mode: "NEFT", date: "13-Jan-2025" },
    { receiptNo: "RV/2025/0231", payer: "District Education Office", head: "0202-Education", amount: "₹8,25,000", mode: "Cheque", date: "12-Jan-2025" },
    { receiptNo: "RV/2025/0230", payer: "State Transport Corp", head: "0041-Taxes on Vehicles", amount: "₹12,75,000", mode: "RTGS", date: "11-Jan-2025" },
    { receiptNo: "RV/2025/0229", payer: "Public Works Dept", head: "0059-Public Works", amount: "₹3,40,000", mode: "Cash", date: "10-Jan-2025" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Receipt Vouchers" subtitle="Revenue receipts with payer details, budget head mapping, and payment mode." back="/finance" />
      <StatGrid>
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Receipts" value={456} />
        <StatCard icon="₹" iconBg="#e7edfd" label="Total Value" value="₹12.8 Cr" />
        <StatCard icon="📊" iconBg="#fffaeb" label="This Month" value={78} />
        <StatCard icon="🏦" iconBg="#eff6ff" label="NEFT/RTGS" value="82%" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Receipt Vouchers</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📥" title="No receipts" message="No receipt vouchers found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "receiptNo", label: "Receipt No" },
              { key: "payer", label: "Payer" },
              { key: "head", label: "Budget Head" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "mode", label: "Mode" },
              { key: "date", label: "Date" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
