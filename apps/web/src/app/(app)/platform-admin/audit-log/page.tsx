import { PageHeader, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { getTenantAuditLog } from "@/app/_data/loaders";
import { toHumanError } from "@/lib/messages";
import { todayIST, istDatePart } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { Breadcrumb } from "../Breadcrumb";
import { AuditLogTable } from "./AuditLogTable";
import type { PlatformAuditEvent } from "./AuditLogTable";

// GAP-PLATFORM-ADMIN-AUDIT-LOG-05/02: the audit log carries actor, IP and
// role of every event — personal/security-intel data. The Export CSV control
// is restricted to platform/audit admin roles; the segment layout already
// admits platform admins and audit reviewers, this narrows the export further.
const AUDIT_EXPORT_ROLES = ["platform_admin", "super_admin", "tenant_admin", "auditor", "audit_admin", "audit_officer"];

export default async function PlatformAuditLogPage() {
  const { data: rawEvents, source } = await getTenantAuditLog();

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-01: a failed load must NOT read as an empty
  // audit trail (0 stats + "No events match"). For a security log that hides
  // that events could not be fetched. Surface a retry state instead.
  if (source === "error") {
    return (
      <div className="page-main wrap">
        <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Audit Log" }]} />
        <PageHeader
          back="/platform-admin"
          title="Platform Audit Log"
          subtitle="Chronological record of all admin actions — timestamp, actor, role, before/after diffs, IP."
        />
        <RefreshErrorState error={toHumanError("load", { area: "audit log" })} backHref="/platform-admin" />
      </div>
    );
  }

  const events: PlatformAuditEvent[] = rawEvents.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    actor: e.actor,
    // GAP-PLATFORM-ADMIN-AUDIT-LOG-07: do NOT default a missing actorRole to
    // "platform_admin" (the highest-privilege role) — that misattributes
    // unknown actors in a forensic view. Leave it empty; the table renders
    // "Unknown".
    actorRole: ((e as Record<string, unknown>).actorRole as string | undefined) ?? "",
    ipAddress: e.ipAddress,
    actionType: ((e as Record<string, unknown>).actionType as string | undefined) ?? e.action.split(".")[0]?.toUpperCase() ?? "SYSTEM",
    action: e.action,
    targetEntity: e.resource ?? "—",
    outcome: e.outcome,
    before: (e as Record<string, unknown>).before as Record<string, unknown> | undefined,
    after: (e as Record<string, unknown>).after as Record<string, unknown> | undefined,
  }));

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-03: "today" must be the IST calendar day, and
  // each event resolved to its IST day — not a raw UTC .slice(0,10) compare,
  // which miscounts events between 00:00 and 05:30 IST.
  const today = todayIST();
  const today24h = events.filter((e) => istDatePart(e.timestamp) === today).length;
  const successes = events.filter((e) => e.outcome === "success").length;
  const failures = events.filter((e) => e.outcome === "failure").length;
  const uniqueActors = new Set(events.map((e) => e.actor)).size;

  const canExport = getSessionRoles().some((r) => AUDIT_EXPORT_ROLES.includes(r));

  return (
    <div className="page-main wrap">
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
      <AuditLogTable events={events} canExport={canExport} />
    </div>
  );
}
