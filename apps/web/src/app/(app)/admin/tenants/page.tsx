import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSATenants } from "@/app/_data/loaders";
import { TenantsTable } from "./TenantsTable";

export default async function TenantsPage() {
  const { data: tenants, source } = await getSATenants();
  const active = tenants.filter((t) => String(t.status).toLowerCase() === "active").length;
  const trial = tenants.filter((t) => String(t.status).toLowerCase() === "trial").length;
  const suspended = tenants.filter((t) => String(t.status).toLowerCase() === "suspended").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside TenantsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader title="Tenants" subtitle="All registered tenants with edition, status and usage details." back="/admin" />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Total Tenants" value={tenants.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="🧪" iconBg="#fffaeb" label="Trial" value={trial} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Suspended" value={suspended} />
      </StatGrid>
      <Card title="Tenant Directory">
        <TenantsTable tenants={tenants} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
