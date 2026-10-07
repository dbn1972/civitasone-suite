import Link from "next/link";
import { PageHeader, StatCard, LoadErrorState } from "@/app/_components/ds";
import { AUDIT_LOG_VIEW_ROLES } from "@/lib/auth/adminRoles";
import { ADMIN_AUDIT_LOG_PAGE_SIZE, getAdminAuditLogEntries } from "@/app/_data/loaders";
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
export default async function AuditLogPage({ searchParams }: { searchParams?: { offset?: string } }) {
  const requested = Number(searchParams?.offset ?? 0);
  const offset = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;
  const res = await getAdminAuditLogEntries(offset);

  // GAP-ADMIN-AUDIT-LOG-01: a 403 (tenant_admin is not an audit-service
  // reader) or a failure used to render "Couldn't load audit events -- showing
  // nothing" under four zeroed stat cards and a "No audit events match" table,
  // so forbidden / failed / empty were indistinguishable.
  if (res.source === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader
          title="Audit Log"
          subtitle="Platform-wide audit trail — real events from audit-service's append-only log."
          back="/admin"
        />
        <LoadErrorState result={res} area="audit events" backHref="/admin" requiredRoles={AUDIT_LOG_VIEW_ROLES} />
      </div>
    );
  }
  const entries = res.data;

  const successCount = entries.filter((e) => e.outcome === "success").length;
  const failureCount = entries.filter((e) => e.outcome === "failure").length;
  const distinctActors = new Set(entries.map((e) => e.actor)).size;

  // GAP-ADMIN-AUDIT-LOG-02: the API is newest-first and capped at one page. A full
  // page means older events exist, so say so and link to them instead of letting an
  // auditor assume this list (and the counts above it) is the whole trail.
  const maybeMore = entries.length >= ADMIN_AUDIT_LOG_PAGE_SIZE;
  const first = entries.length === 0 ? 0 : offset + 1;
  const last = offset + entries.length;
  const olderOffset = offset + ADMIN_AUDIT_LOG_PAGE_SIZE;
  const newerOffset = Math.max(0, offset - ADMIN_AUDIT_LOG_PAGE_SIZE);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Audit Log"
        subtitle="Platform-wide audit trail — real events from audit-service's append-only log."
        back="/admin"
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="#f1f5f9" label="Events on this page" value={entries.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Success (this page)" value={successCount} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Failure (this page)" value={failureCount} />
        <StatCard icon="👤" iconBg="#eff6ff" label="Actors on this page" value={distinctActors} />
      </div>
      <div role="note" data-testid="audit-log-window" style={{ fontSize: 13, color: "var(--mut)", marginBottom: 12 }}>
        Showing events {first}–{last}, newest first. Search, filters and the counts above cover only these events.
        {maybeMore && (
          <>
            {" "}This is a full page, so older events exist:{" "}
            <Link href={`/admin/audit-log?offset=${olderOffset}`}>Show older events</Link>.
          </>
        )}
        {offset > 0 && (
          <>
            {" "}
            <Link href={newerOffset === 0 ? "/admin/audit-log" : `/admin/audit-log?offset=${newerOffset}`}>Show newer events</Link>.
          </>
        )}
      </div>
      <AuditLogTable entries={entries} />
    </div>
  );
}
