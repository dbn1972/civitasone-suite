import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSADashboard } from "@/app/_data/loaders";
import { SADashboardTable } from "./SADashboardTable";

export default async function SaDashboardPage() {
  const { data: dashboard, source } = await getSADashboard();
  const tenants = Number(dashboard.activeTenants ?? 0);
  const users = Number(dashboard.totalUsers ?? 0);
  const uptime = String(dashboard.uptime ?? "99.9%");

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Super Admin Dashboard"
        subtitle="Platform-wide health, revenue and growth overview."
        back="/admin"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Active Tenants" value={tenants} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Total Users" value={users} />
        <StatCard icon="💚" iconBg="#fffaeb" label="Platform Uptime" value={uptime} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Services" value="33" />
      </StatGrid>
      <Card title="Platform KPIs">
        <SADashboardTable dashboard={dashboard} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
