import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function CashBankPage() {
  type Row = { date: string; particulars: string; voucherNo: string; receipt: string; payment: string; balance: string; [k: string]: unknown };
  const rows: Row[] = [
    { date: "15-Jan-2025", particulars: "Opening Balance", voucherNo: "—", receipt: "—", payment: "—", balance: "₹4,56,78,000" },
    { date: "15-Jan-2025", particulars: "Receipt from Treasury — Grant-in-aid", voucherNo: "RV/2025/0234", receipt: "₹1,20,00,000", payment: "—", balance: "₹5,76,78,000" },
    { date: "15-Jan-2025", particulars: "Payment to M/s Tata Projects Ltd", voucherNo: "PV/2025/0567", receipt: "—", payment: "₹45,00,000", balance: "₹5,31,78,000" },
    { date: "14-Jan-2025", particulars: "Receipt — Property Tax Collection", voucherNo: "RV/2025/0233", receipt: "₹18,50,000", payment: "—", balance: "₹5,50,28,000" },
    { date: "14-Jan-2025", particulars: "Payment to Bharat Electronics Ltd", voucherNo: "PV/2025/0566", receipt: "—", payment: "₹12,50,000", balance: "₹5,37,78,000" },
    { date: "13-Jan-2025", particulars: "Payment — Salary (Jan 2025)", voucherNo: "PV/2025/0565", receipt: "—", payment: "₹2,80,00,000", balance: "₹5,50,28,000" },
    { date: "13-Jan-2025", particulars: "Receipt — Fee Collections", voucherNo: "RV/2025/0232", receipt: "₹8,25,000", payment: "—", balance: "₹8,30,28,000" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Cash & Bank Book" subtitle="Day book with receipts, payments, and running balance." back="/finance" />
      <StatGrid>
        <StatCard icon="📖" iconBg="#e7edfd" label="Current Balance" value="₹5.32 Cr" />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Receipts (MTD)" value="₹3.46 Cr" />
        <StatCard icon="📤" iconBg="#fce7ee" label="Payments (MTD)" value="₹2.18 Cr" />
        <StatCard icon="📊" iconBg="#fffaeb" label="Entries Today" value={5} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Cash & Bank Entries</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📖" title="No entries" message="No cash & bank book entries found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "date", label: "Date" },
              { key: "particulars", label: "Particulars" },
              { key: "voucherNo", label: "Voucher No" },
              { key: "receipt", label: "Receipt", align: "right" },
              { key: "payment", label: "Payment", align: "right" },
              { key: "balance", label: "Balance", align: "right" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
