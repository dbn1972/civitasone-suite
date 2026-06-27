import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function EmpanelmentPage() {
  type Row = { vendorName: string; category: string; validUntil: string; rating: number; status: string };

  const rows: Row[] = [
    { vendorName: "Aravali Constructions Pvt Ltd", category: "Civil Works", validUntil: "2026-03-31", rating: 4.2, status: "Active" },
    { vendorName: "DigiGov Solutions", category: "IT Services", validUntil: "2025-12-31", rating: 4.6, status: "Active" },
    { vendorName: "Surgipharma India", category: "Medical Supplies", validUntil: "2025-09-30", rating: 3.8, status: "Active" },
    { vendorName: "TechServe India", category: "IT Hardware", validUntil: "2025-02-15", rating: 3.2, status: "Expiring" },
    { vendorName: "Bharat Infrastructure Ltd", category: "Civil Works", validUntil: "2024-12-31", rating: 4.0, status: "Expired" },
    { vendorName: "PowerGrid Solutions", category: "Electrical", validUntil: "2026-06-30", rating: 4.5, status: "Active" },
    { vendorName: "Godrej Interio", category: "Furniture", validUntil: "2025-08-15", rating: 4.1, status: "Active" },
    { vendorName: "JK Paper Ltd", category: "Stationery", validUntil: "2025-11-30", rating: 3.9, status: "Under Review" },
  ];

  const columns = [
    { key: "vendorName" as const, label: "Vendor Name" },
    { key: "category" as const, label: "Category" },
    { key: "validUntil" as const, label: "Valid Until" },
    { key: "rating" as const, label: "Rating", align: "center" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Vendor Empanelment" subtitle="Empanelled vendors with category-wise validity and performance ratings." back="/procurement" />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Total Empanelled" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={5} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expiring Soon" value={1} />
        <StatCard icon="⭐" iconBg="#fce7ee" label="Avg. Rating" value="4.0" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Empanelled Vendors</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
