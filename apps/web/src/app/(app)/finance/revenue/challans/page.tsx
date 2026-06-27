import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function ChallansPage() {
  type Row = { id: string; challanNo: string; department: string; amount: string; bank: string; date: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { id: "chn-001", challanNo: "CHN/2024/001", department: "Revenue Department", amount: "₹15,00,000", bank: "SBI", date: "15-Jan-2025", status: "approved" },
    { id: "chn-002", challanNo: "CHN/2024/002", department: "Public Works", amount: "₹8,50,000", bank: "PNB", date: "14-Jan-2025", status: "approved" },
    { id: "chn-003", challanNo: "CHN/2024/003", department: "Education", amount: "₹3,25,000", bank: "BOB", date: "13-Jan-2025", status: "pending" },
    { id: "chn-004", challanNo: "CHN/2024/004", department: "Health & Family Welfare", amount: "₹22,00,000", bank: "Union Bank", date: "12-Jan-2025", status: "approved" },
    { id: "chn-005", challanNo: "CHN/2024/005", department: "Agriculture", amount: "₹6,75,000", bank: "SBI", date: "11-Jan-2025", status: "rejected" },
    { id: "chn-006", challanNo: "CHN/2024/006", department: "Urban Development", amount: "₹42,00,000", bank: "PNB", date: "10-Jan-2025", status: "approved" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Challan Register" subtitle="Government challans issued to departments with bank deposit verification." back="/finance" />
      <StatGrid>
        <StatCard icon="📄" iconBg="#e7edfd" label="Total Challans" value={312} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Verified" value={278} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={28} />
        <StatCard icon="₹" iconBg="#eff6ff" label="Total Value" value="₹18.4 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Challans</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📄" title="No challans" message="No challans found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "challanNo", label: "Challan No" },
              { key: "department", label: "Department" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "bank", label: "Bank" },
              { key: "date", label: "Date" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/finance/revenue/challans/"
          />
        )}
      </div>
    </main>
  );
}
