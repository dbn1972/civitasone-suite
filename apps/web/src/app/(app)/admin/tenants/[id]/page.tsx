import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  type Row = { module: string; enabled: string; users: number; lastActivity: string; usage: string };

  const rows: Row[] = [
    { module: "Finance & Accounts", enabled: "Yes", users: 45, lastActivity: "2025-02-10", usage: "High" },
    { module: "HRMS & Payroll", enabled: "Yes", users: 28, lastActivity: "2025-02-10", usage: "High" },
    { module: "Procurement", enabled: "Yes", users: 32, lastActivity: "2025-02-09", usage: "Medium" },
    { module: "Projects & Works", enabled: "Yes", users: 18, lastActivity: "2025-02-08", usage: "Medium" },
    { module: "Citizen Services", enabled: "Yes", users: 12, lastActivity: "2025-02-10", usage: "High" },
    { module: "Audit & Compliance", enabled: "Yes", users: 8, lastActivity: "2025-02-07", usage: "Low" },
    { module: "Asset Management", enabled: "No", users: 0, lastActivity: "—", usage: "—" },
    { module: "Legal Case Management", enabled: "No", users: 0, lastActivity: "—", usage: "—" },
  ];

  const columns = [
    { key: "module" as const, label: "Module" },
    { key: "enabled" as const, label: "Enabled" },
    { key: "users" as const, label: "Active Users", align: "right" as const },
    { key: "lastActivity" as const, label: "Last Activity" },
    { key: "usage" as const, label: "Usage Level", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={`Tenant: ${decodeURIComponent(id)}`} subtitle="Configuration, enabled modules and usage statistics." back="/admin/tenants" />
      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Modules Enabled" value={6} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Active Users" value={143} />
        <StatCard icon="📊" iconBg="#fffaeb" label="API Calls (30d)" value="1.2M" />
        <StatCard icon="💾" iconBg="#fce7ee" label="Storage Used" value="2.8 GB" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Module Usage</h3></div>
        <DataTable columns={columns} rows={rows} sortable />
      </div>
    </main>
  );
}
