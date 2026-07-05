import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSATechAdmin } from "@/app/_data/loaders";
import { TechAdminTable } from "./TechAdminTable";

export default async function TechAdminPage() {
  const { data: services, source } = await getSATechAdmin();
  const running = services.filter((s) => String(s.status).toLowerCase() === "running").length;
  const stopped = services.filter((s) => String(s.status).toLowerCase() === "stopped").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Tech Admin" subtitle="Service health, database connections, and infrastructure status." back="/admin" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="⚙️" iconBg="#eef2ff" label="Services" value={services.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Running" value={running} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Stopped" value={stopped} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={services.length - running - stopped} />
      </StatGrid>
      <Card title="Service Status">
        <TechAdminTable services={services} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
