import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function UserChargesPage() {
  type Row = { service: string; rate: string; collectionsMonth: string; ytd: string; transactions: number; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { service: "Water Supply Connection", rate: "₹500/month", collectionsMonth: "₹18,50,000", ytd: "₹1,85,00,000", transactions: 3700, status: "active" },
    { service: "Sewerage Charges", rate: "₹200/month", collectionsMonth: "₹8,20,000", ytd: "₹82,00,000", transactions: 4100, status: "active" },
    { service: "Parking Fee", rate: "₹50/hour", collectionsMonth: "₹12,45,000", ytd: "₹1,24,50,000", transactions: 24900, status: "active" },
    { service: "Birth/Death Certificate", rate: "₹50/copy", collectionsMonth: "₹2,85,000", ytd: "₹28,50,000", transactions: 5700, status: "active" },
    { service: "Building Plan Scrutiny", rate: "₹10/sq.ft", collectionsMonth: "₹6,80,000", ytd: "₹68,00,000", transactions: 45, status: "active" },
    { service: "Solid Waste Management", rate: "₹150/month", collectionsMonth: "₹22,50,000", ytd: "₹2,25,00,000", transactions: 15000, status: "active" },
    { service: "Library Membership", rate: "₹200/year", collectionsMonth: "₹1,20,000", ytd: "₹12,00,000", transactions: 600, status: "active" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="User Charges & Service Fees" subtitle="Service-wise user charges with monthly and YTD collection tracking." back="/finance" />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e7edfd" label="Active Services" value={24} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="This Month" value="₹72.5 L" />
        <StatCard icon="📊" iconBg="#fffaeb" label="YTD Collections" value="₹7.25 Cr" />
        <StatCard icon="📈" iconBg="#eff6ff" label="Transactions" value="54,045" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>User Charges</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🧾" title="No charges" message="No user charges data available." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "service", label: "Service" },
              { key: "rate", label: "Rate" },
              { key: "collectionsMonth", label: "This Month", align: "right" },
              { key: "ytd", label: "YTD", align: "right" },
              { key: "transactions", label: "Transactions", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
