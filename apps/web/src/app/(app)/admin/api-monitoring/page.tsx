import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAApiMonitoring } from "@/app/_data/loaders";
import { ApiMonitoringTable } from "./ApiMonitoringTable";

export default async function ApiMonitoringPage() {
  const { data: endpoints, source } = await getSAApiMonitoring();
  const healthy = endpoints.filter((e) => String(e.status).toLowerCase() === "healthy").length;
  const degraded = endpoints.filter((e) => String(e.status).toLowerCase() === "degraded").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="API Monitoring" subtitle="Service endpoint health, latency and error rates." back="/admin" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="🔌" iconBg="#eef2ff" label="Endpoints" value={endpoints.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Healthy" value={healthy} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={degraded} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Down" value={endpoints.length - healthy - degraded} />
      </StatGrid>
      <Card title="API Endpoints">
        <ApiMonitoringTable endpoints={endpoints} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
