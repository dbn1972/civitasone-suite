import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getSiemAlerts } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { SiemTable } from "./SiemTable";
import { isOpenSiemStatus } from "./siemHelpers";

export default async function SiemPage() {
  const result = await getSiemAlerts();
  const { data: alerts, source } = result;
  const errored = toResourceState(result).status === "error";
  const criticalAlerts = alerts.filter((a) => a.severity === "critical").length;
  const highAlerts = alerts.filter((a) => a.severity === "high").length;
  // GAP-TENANT-ADMIN-SIEM-03: "Active" = the open incident lifecycle states
  // (detected/triaged/contained), shared with the table's status tones.
  const activeAlerts = alerts.filter((a) => isOpenSiemStatus(a.status)).length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="SIEM & Threat Monitoring"
        subtitle="Security alerts detected for this tenant. Near real-time (refreshes about every 30 seconds)."
      />
      {/* UX-012: the data-source badge now lives inside SiemTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}

      <StatGrid>
        <StatCard icon="🚨" tone="bad" label="Critical Alerts" value={errored ? "—" : criticalAlerts} />
        <StatCard icon="⚠️" tone="warn" label="High Severity" value={errored ? "—" : highAlerts} />
        <StatCard icon="👁️" tone="info" label="Active Alerts" value={errored ? "—" : activeAlerts} />
        <StatCard icon="📊" tone="neutral" label="Total Alerts" value={errored ? "—" : alerts.length} />
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
