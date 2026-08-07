import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PlaceholderButton } from "../../../_components/PlaceholderButton";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getTenantAuditLog } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { AuditLogTable } from "./AuditLogTable";

export default async function TenantAuditPage() {
  const { data: events, source } = await getTenantAuditLog();

  const today = new Date().toISOString().slice(0, 10);

  const total = events.length;
  const successes = events.filter((e) => e.outcome === "success").length;
  const failures = events.filter((e) => e.outcome === "failure").length;
  const today24h = events.filter((e) => e.timestamp.slice(0, 10) === today).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Audit Log" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Audit Log"
        subtitle="Tenant-scoped audit events — all actor actions and outcomes."
        actions={
          <>
            <PrintExportButton label="Export" style={{ minHeight: 44 }} documentTitle="Audit Log" />
            <PlaceholderButton label="Filter" style={{ minHeight: 44 }} />
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="#f1f5f9" label="Events (24h)" value={today24h} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Success" value={successes} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Failures" value={failures} />
        <StatCard icon="👥" iconBg="#eff6ff" label="Total Events" value={total} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <AuditLogTable
        events={events.map((event) => ({
          id: event.id,
          timestamp: event.timestamp,
          actor: event.actor,
          ipAddress: event.ipAddress,
          action: event.action,
          resource: event.resource,
          outcome: event.outcome,
        }))}
      />
    </main>
  );
}
