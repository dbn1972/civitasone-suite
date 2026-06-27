import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function TechAdminPage() {
  type Row = { service: string; version: string; lastDeploy: string; health: string; replicas: number };

  const rows: Row[] = [
    { service: "api-gateway", version: "v2.14.3", lastDeploy: "2025-02-09 14:30", health: "Healthy", replicas: 4 },
    { service: "finance-service", version: "v3.8.1", lastDeploy: "2025-02-08 10:15", health: "Healthy", replicas: 3 },
    { service: "hrms-service", version: "v2.12.0", lastDeploy: "2025-02-07 16:45", health: "Healthy", replicas: 3 },
    { service: "procurement-service", version: "v2.6.4", lastDeploy: "2025-02-09 11:00", health: "Healthy", replicas: 2 },
    { service: "citizen-service", version: "v1.9.2", lastDeploy: "2025-02-05 09:30", health: "Degraded", replicas: 3 },
    { service: "notification-service", version: "v1.5.8", lastDeploy: "2025-02-06 13:20", health: "Healthy", replicas: 2 },
    { service: "analytics-service", version: "v2.3.0", lastDeploy: "2025-02-09 08:00", health: "Healthy", replicas: 2 },
    { service: "auth-service", version: "v4.1.2", lastDeploy: "2025-02-04 20:00", health: "Healthy", replicas: 4 },
  ];

  const columns = [
    { key: "service" as const, label: "Service" },
    { key: "version" as const, label: "Version" },
    { key: "lastDeploy" as const, label: "Last Deploy" },
    { key: "health" as const, label: "Health", cellType: "status" as const },
    { key: "replicas" as const, label: "Replicas", align: "center" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Technical Administration" subtitle="Microservice health, versions, deployments and scaling." back="/admin" />
      <StatGrid>
        <StatCard icon="🖥️" iconBg="#eef2ff" label="Services" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Healthy" value={7} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={1} />
        <StatCard icon="📦" iconBg="#fce7ee" label="Total Replicas" value={23} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Service Registry</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
