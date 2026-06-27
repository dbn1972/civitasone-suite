import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function LicensesPage() {
  type Row = { id: string; licenseType: string; holder: string; validFrom: string; validTo: string; fee: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { id: "lic-001", licenseType: "Trade License", holder: "M/s Gupta & Sons", validFrom: "01-Apr-2024", validTo: "31-Mar-2025", fee: "₹25,000", status: "active" },
    { id: "lic-002", licenseType: "Building Permission", holder: "Sunrise Developers Pvt Ltd", validFrom: "15-Jun-2024", validTo: "14-Jun-2026", fee: "₹3,50,000", status: "active" },
    { id: "lic-003", licenseType: "Factory License", holder: "Bharat Electronics Ltd", validFrom: "01-Jan-2024", validTo: "31-Dec-2024", fee: "₹1,20,000", status: "overdue" },
    { id: "lic-004", licenseType: "Liquor License", holder: "Hotel Rajmahal Pvt Ltd", validFrom: "01-Apr-2024", validTo: "31-Mar-2025", fee: "₹8,50,000", status: "active" },
    { id: "lic-005", licenseType: "Mining Lease", holder: "National Mineral Dev Corp", validFrom: "01-Jul-2023", validTo: "30-Jun-2028", fee: "₹45,00,000", status: "active" },
    { id: "lic-006", licenseType: "Water Connection", holder: "Metro Constructions", validFrom: "15-Aug-2024", validTo: "14-Aug-2025", fee: "₹15,000", status: "active" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="License & Fees" subtitle="Issued licenses, permits, and associated fee collection tracking." back="/finance" />
      <StatGrid>
        <StatCard icon="📜" iconBg="#e7edfd" label="Active Licenses" value={342} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="Revenue (YTD)" value="₹8.5 Cr" />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Expiring (30d)" value={28} />
        <StatCard icon="🚫" iconBg="#fffaeb" label="Overdue Renewal" value={15} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Licenses</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📜" title="No licenses" message="No licenses found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "licenseType", label: "License Type" },
              { key: "holder", label: "Holder" },
              { key: "validFrom", label: "Valid From" },
              { key: "validTo", label: "Valid To" },
              { key: "fee", label: "Fee", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/finance/licenses/"
          />
        )}
      </div>
    </main>
  );
}
