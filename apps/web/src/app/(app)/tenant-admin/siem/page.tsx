import { PageHeader, StatCard, StatGrid, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getSiemAlerts } from "@/app/_data/loaders";
import { SiemTable } from "./SiemTable";

export default async function SiemPage() {
  const { data: alerts, source } = await getSiemAlerts();
  const criticalAlerts = alerts.filter((a) => a.severity === "critical").length;
  const highAlerts = alerts.filter((a) => a.severity === "high").length;
  const activeAlerts = alerts.filter((a) => a.status === "active" || a.status === "investigating").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "SIEM & Threat Monitoring" }]} />
      <PageHeader
        back="/tenant-admin"
        title="SIEM & Threat Monitoring"
        subtitle="Real-time threat intelligence, blocked IPs, suspicious activity, and security alert management."
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Critical Alerts" value={criticalAlerts} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="High Severity" value={highAlerts} />
        <StatCard icon="👁️" iconBg="#eff6ff" label="Active Alerts" value={activeAlerts} />
        <StatCard icon="📊" iconBg="#f1f5f9" label="Total Alerts" value={alerts.length} />
      </StatGrid>

      {alerts.length === 0 ? (
        <Card title="Security Alerts">
          <EmptyState
            icon="🛡️"
            title="No security alerts"
            message="Your environment is currently clear of detected threats."
          />
        </Card>
      ) : (
        <Card title="Security Alerts">
          <SiemTable alerts={alerts} source={source} />
        </Card>
      )}
    </main>
  );
}
