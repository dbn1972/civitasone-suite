import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getSiemAlerts } from "@/app/_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { SiemTable } from "./SiemTable";

export default async function SiemPage() {
  const result = await getSiemAlerts();
  const { data: alerts, source } = result;
  const errored = useResource(result).status === "error";
  const criticalAlerts = alerts.filter((a) => a.severity === "critical").length;
  const highAlerts = alerts.filter((a) => a.severity === "high").length;
  const activeAlerts = alerts.filter((a) => a.status === "active" || a.status === "investigating").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "SIEM & Threat Monitoring" }]} />
      <PageHeader
        back="/tenant-admin"
        title="SIEM & Threat Monitoring"
        subtitle="Real-time threat intelligence, blocked IPs, suspicious activity, and security alert management."
      />
      {/* UX-012: the data-source badge now lives inside SiemTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}

      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Critical Alerts" value={errored ? "—" : criticalAlerts} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="High Severity" value={errored ? "—" : highAlerts} />
        <StatCard icon="👁️" iconBg="#eff6ff" label="Active Alerts" value={errored ? "—" : activeAlerts} />
        <StatCard icon="📊" iconBg="#f1f5f9" label="Total Alerts" value={errored ? "—" : alerts.length} />
      </StatGrid>

      {errored ? (
        <Card title="Security Alerts">
          <RefreshErrorState error={toHumanError("load", { area: "SIEM alerts" })} backHref="/tenant-admin" />
        </Card>
      ) : alerts.length === 0 ? (
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
    </div>
  );
}
