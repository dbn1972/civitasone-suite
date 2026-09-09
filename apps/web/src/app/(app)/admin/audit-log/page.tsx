import { PageHeader, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getAdminAuditLogEntries } from "@/app/_data/loaders";
import { AuditLogTable } from "./AuditLogTable";

// COMP-004: this page used to synthesize 25 fake audit entries client-side
// (mockAuditData()) with no relation to anything that actually happened.
// Now backed by the real GET /v1/admin/audit-logs route (forwarded to
// audit-service's append-only event log, COMP-001) via a server loader — the
// same DataSourceBadge/EmptyState pattern used across the other admin pages
// COMP-001/COMP-002 already fixed.
//
// Note: audit-service's own role gate (audit_officer/audit_admin/super_admin/
// platform_admin) does NOT include tenant_admin. A tenant_admin viewing this
// page gets a real 403 relayed through as source:"error" — that is the
// correct, honest behaviour for a resource this platform deliberately
// restricts, not a bug in this fix (see gap/routes.ts's GET /v1/admin/audit-
// logs comment).
export default async function AuditLogPage() {
  const { data: entries, source } = await getAdminAuditLogEntries();

  const successCount = entries.filter((e) => e.outcome === "success").length;
  const failureCount = entries.filter((e) => e.outcome === "failure").length;
  const distinctActors = new Set(entries.map((e) => e.actor)).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Audit Log"
        subtitle="Platform-wide audit trail — real events from audit-service's append-only log."
        back="/admin"
      />
      <DataSourceBadge source={source} message="Couldn't load audit events — showing nothing" />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="#f1f5f9" label="Loaded events" value={entries.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Success" value={successCount} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Failure" value={failureCount} />
        <StatCard icon="👤" iconBg="#eff6ff" label="Actors (distinct)" value={distinctActors} />
      </div>
      <AuditLogTable entries={entries} />
    </main>
  );
}
