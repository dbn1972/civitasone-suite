import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function ApiMonitoringPage() {
  type Row = { endpoint: string; p95Latency: string; errorRate: string; callsPerMin: number; status: string };

  const rows: Row[] = [
    { endpoint: "/api/v1/finance/vouchers", p95Latency: "180ms", errorRate: "0.02%", callsPerMin: 245, status: "Healthy" },
    { endpoint: "/api/v1/hr/attendance", p95Latency: "120ms", errorRate: "0.01%", callsPerMin: 890, status: "Healthy" },
    { endpoint: "/api/v1/procurement/orders", p95Latency: "340ms", errorRate: "0.15%", callsPerMin: 156, status: "Healthy" },
    { endpoint: "/api/v1/citizen/requests", p95Latency: "520ms", errorRate: "1.2%", callsPerMin: 420, status: "Degraded" },
    { endpoint: "/api/v1/auth/token", p95Latency: "95ms", errorRate: "0.5%", callsPerMin: 1200, status: "Healthy" },
    { endpoint: "/api/v1/reports/generate", p95Latency: "2400ms", errorRate: "3.1%", callsPerMin: 45, status: "Warning" },
    { endpoint: "/api/v1/analytics/query", p95Latency: "1800ms", errorRate: "0.8%", callsPerMin: 78, status: "Healthy" },
    { endpoint: "/api/v1/notifications/send", p95Latency: "210ms", errorRate: "0.05%", callsPerMin: 320, status: "Healthy" },
  ];

  const columns = [
    { key: "endpoint" as const, label: "Endpoint" },
    { key: "p95Latency" as const, label: "p95 Latency" },
    { key: "errorRate" as const, label: "Error Rate" },
    { key: "callsPerMin" as const, label: "Calls/min", align: "right" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="API Monitoring" subtitle="Real-time endpoint performance, latency and error tracking." back="/admin" />
      <StatGrid>
        <StatCard icon="📡" iconBg="#eef2ff" label="Total Endpoints" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Healthy" value={6} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded/Warning" value={2} />
        <StatCard icon="⚡" iconBg="#fce7ee" label="Avg. p95" value="245ms" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Endpoint Health</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
