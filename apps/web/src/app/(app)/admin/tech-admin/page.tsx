import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSATechAdmin } from "@/app/_data/loaders";
import { TechAdminTable } from "./TechAdminTable";

export default async function TechAdminPage() {
  const { data: services, source } = await getSATechAdmin();
  const running = services.filter((s) => String(s.status).toLowerCase() === "running").length;
  const stopped = services.filter((s) => String(s.status).toLowerCase() === "stopped").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside TechAdminTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader title="Tech Admin" subtitle="Service health, database connections, and infrastructure status." back="/admin" />
      <StatGrid>
        <StatCard icon="⚙️" iconBg="#eef2ff" label="Services" value={services.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Running" value={running} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Stopped" value={stopped} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={services.length - running - stopped} />
      </StatGrid>
      <Card title="Service Status">
        <TechAdminTable services={services} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
