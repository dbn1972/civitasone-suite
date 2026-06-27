import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function EntitlementsPage() {
  type Row = { module: string; edition: string; limit: string; override: string; status: string };

  const rows: Row[] = [
    { module: "Finance & Accounts", edition: "Government", limit: "Unlimited users", override: "—", status: "Active" },
    { module: "HRMS & Payroll", edition: "Small Office", limit: "50 employees", override: "75 (custom)", status: "Override" },
    { module: "Procurement", edition: "PSU", limit: "500 POs/month", override: "—", status: "Active" },
    { module: "Projects & Works", edition: "Government", limit: "100 active projects", override: "—", status: "Active" },
    { module: "Citizen Services", edition: "Municipal", limit: "50,000 requests/month", override: "—", status: "Active" },
    { module: "Asset Management", edition: "Small Office", limit: "1,000 assets", override: "2,000 (custom)", status: "Override" },
    { module: "AI Insights", edition: "Enterprise", limit: "Unlimited", override: "—", status: "Active" },
    { module: "API Access", edition: "Trial", limit: "10,000 calls/month", override: "—", status: "Rate Limited" },
  ];

  const columns = [
    { key: "module" as const, label: "Module" },
    { key: "edition" as const, label: "Edition" },
    { key: "limit" as const, label: "Limit" },
    { key: "override" as const, label: "Override" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Entitlement Rules" subtitle="Module-level limits and overrides per edition." back="/admin" />
      <StatGrid>
        <StatCard icon="🔑" iconBg="#eef2ff" label="Total Rules" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={5} />
        <StatCard icon="⚡" iconBg="#fffaeb" label="Overrides" value={2} />
        <StatCard icon="🚫" iconBg="#fce7ee" label="Rate Limited" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Entitlement Matrix</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
