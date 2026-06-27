import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function EditionsPage() {
  type Row = { name: string; modulesIncluded: number; pricing: string; tenants: number; status: string };

  const rows: Row[] = [
    { name: "Small Office", modulesIncluded: 6, pricing: "₹1,50,000/yr", tenants: 12, status: "Active" },
    { name: "PSU", modulesIncluded: 12, pricing: "₹4,50,000/yr", tenants: 18, status: "Active" },
    { name: "Government", modulesIncluded: 18, pricing: "₹8,50,000/yr", tenants: 42, status: "Active" },
    { name: "Enterprise", modulesIncluded: 22, pricing: "Custom", tenants: 8, status: "Active" },
    { name: "Municipal", modulesIncluded: 15, pricing: "₹6,00,000/yr", tenants: 24, status: "Active" },
    { name: "Trial", modulesIncluded: 4, pricing: "Free (30 days)", tenants: 15, status: "Active" },
    { name: "Legacy (Deprecated)", modulesIncluded: 8, pricing: "₹2,00,000/yr", tenants: 3, status: "Deprecated" },
  ];

  const columns = [
    { key: "name" as const, label: "Edition Name" },
    { key: "modulesIncluded" as const, label: "Modules Included", align: "center" as const },
    { key: "pricing" as const, label: "Pricing" },
    { key: "tenants" as const, label: "Tenants", align: "right" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Edition Catalog" subtitle="Platform editions with module bundles, pricing and tenant allocation." back="/admin" />
      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Total Editions" value={7} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={6} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Total Tenants" value={122} />
        <StatCard icon="💰" iconBg="#fce7ee" label="Avg. Revenue/Tenant" value="₹3.5L" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Editions</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
