import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAApiMonitoring } from "@/app/_data/loaders";
import { ApiMonitoringTable } from "./ApiMonitoringTable";

export default async function ApiMonitoringPage() {
  const { data: endpoints, source } = await getSAApiMonitoring();
  const healthy = endpoints.filter((e) => String(e.status).toLowerCase() === "healthy").length;
  const degraded = endpoints.filter((e) => String(e.status).toLowerCase() === "degraded").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside ApiMonitoringTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader title="API Monitoring" subtitle="Service endpoint health, latency and error rates." back="/admin" />
      <StatGrid>
        <StatCard icon="🔌" iconBg="#eef2ff" label="Endpoints" value={endpoints.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Healthy" value={healthy} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={degraded} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Down" value={endpoints.length - healthy - degraded} />
      </StatGrid>
      <Card title="API Endpoints">
        <ApiMonitoringTable endpoints={endpoints} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
