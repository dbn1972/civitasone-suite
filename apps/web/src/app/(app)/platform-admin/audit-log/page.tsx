import { PageHeader, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getTenantAuditLog } from "@/app/_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { AuditLogTable } from "./AuditLogTable";
import type { PlatformAuditEvent } from "./AuditLogTable";

export default async function PlatformAuditLogPage() {
  const { data: rawEvents, source } = await getTenantAuditLog();

  const today = new Date().toISOString().slice(0, 10);
  const events: PlatformAuditEvent[] = rawEvents.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    actor: e.actor,
    actorRole: (e as Record<string, unknown>).actorRole as string ?? "platform_admin",
    ipAddress: e.ipAddress,
    actionType: (e as Record<string, unknown>).actionType as string ?? e.action.split(".")[0]?.toUpperCase() ?? "SYSTEM",
    action: e.action,
    targetEntity: e.resource ?? "—",
    outcome: e.outcome,
    before: (e as Record<string, unknown>).before as Record<string, unknown> | undefined,
    after: (e as Record<string, unknown>).after as Record<string, unknown> | undefined,
  }));

  const today24h = events.filter((e) => e.timestamp.slice(0, 10) === today).length;
  const successes = events.filter((e) => e.outcome === "success").length;
  const failures = events.filter((e) => e.outcome === "failure").length;
  const uniqueActors = new Set(events.map((e) => e.actor)).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Audit Log" }]} />
      <PageHeader
        back="/platform-admin"
        title="Platform Audit Log"
        subtitle="Chronological record of all admin actions — timestamp, actor, role, before/after diffs, IP."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="#f1f5f9" label="Events (today)" value={today24h} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Success" value={successes} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Failures" value={failures} />
        <StatCard icon="👥" iconBg="#eff6ff" label="Unique actors" value={uniqueActors} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <AuditLogTable events={events} />
    </main>
  );
}
