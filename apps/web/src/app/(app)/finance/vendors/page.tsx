import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function VendorsPage() {
  type Row = { id: string; name: string; pan: string; gstin: string; category: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { id: "v-001", name: "M/s Tata Projects Ltd", pan: "AAACT1234A", gstin: "09AAACT1234A1Z5", category: "Works Contractor", status: "active" },
    { id: "v-002", name: "Bharat Electronics Ltd", pan: "AABCB5678B", gstin: "29AABCB5678B1ZK", category: "Equipment Supplier", status: "active" },
    { id: "v-003", name: "HCL Infosystems Ltd", pan: "AAACH9012C", gstin: "07AAACH9012C1ZL", category: "IT Services", status: "active" },
    { id: "v-004", name: "NBCC India Ltd", pan: "AABCN3456D", gstin: "09AABCN3456D1ZM", category: "Works Contractor", status: "active" },
    { id: "v-005", name: "Wipro Infrastructure", pan: "AABCW7890E", gstin: "29AABCW7890E1ZN", category: "IT Services", status: "pending" },
    { id: "v-006", name: "L&T Construction", pan: "AABCL2345F", gstin: "27AABCL2345F1ZP", category: "Works Contractor", status: "active" },
    { id: "v-007", name: "M/s Gupta & Sons", pan: "ABCPG6789G", gstin: "09ABCPG6789G1ZQ", category: "Stationery Supplier", status: "active" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Vendor Master" subtitle="Registered vendors with PAN, GSTIN, and category classification." back="/finance" />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#e7edfd" label="Total Vendors" value={486} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={452} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval" value={24} />
        <StatCard icon="🚫" iconBg="#fce7ee" label="Blacklisted" value={10} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Vendors</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🏢" title="No vendors" message="No vendors registered yet." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "name", label: "Vendor Name" },
              { key: "pan", label: "PAN" },
              { key: "gstin", label: "GSTIN" },
              { key: "category", label: "Category" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/finance/vendors/"
          />
        )}
      </div>
    </main>
  );
}
