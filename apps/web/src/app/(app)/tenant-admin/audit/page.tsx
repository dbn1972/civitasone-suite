import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard, RefreshErrorState } from "../../../_components/ds";
import { getTenantAuditLog } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { countLast24h } from "@/lib/formatters";
import { Breadcrumb } from "../Breadcrumb";
import { AuditLogTable } from "./AuditLogTable";

export default async function TenantAuditPage({ searchParams }: { searchParams?: { entity?: string } }) {
  const result = await getTenantAuditLog();
  const { data: events, source } = result;

  // GAP-TENANT-ADMIN-AUDIT-05 (FAILMASK): on a failed load the page used to
  // show 0s with only a small badge. Gate on the resource state and show a
  // retry state + '—' stats instead.
  const state = toResourceState(result, (d) => d.length === 0);
  const errored = state.status === "error";

  // GAP-TENANT-ADMIN-NOTIFICATIONS-03: when the notification-preferences page
  // links here with ?entity=notification-prefs, scope the list + KPIs to the
  // preference-change audit events (actions set_prefs / update_prefs) so
  // "Audit changes" lands on the relevant records rather than the whole log.
  const entity = searchParams?.entity;
  const ENTITY_ACTIONS: Record<string, readonly string[]> = {
    "notification-prefs": ["set_prefs", "update_prefs"],
  };
  const actionFilter = entity ? ENTITY_ACTIONS[entity] : undefined;
  const scoped = actionFilter ? events.filter((e) => actionFilter.includes(e.action)) : events;

  // GAP-TENANT-ADMIN-AUDIT-01: rolling 24h window (not a UTC calendar day).
  const last24h = countLast24h(scoped);
  const loaded = scoped.length;
  const successes = scoped.filter((e) => e.outcome === "success").length;
  const failures = scoped.filter((e) => e.outcome === "failure").length;

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Audit Log" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Audit Log"
        subtitle="Tenant-scoped audit events — all actor actions and outcomes."
        actions={
          // GAP-TENANT-ADMIN-AUDIT-02: the dead "Filter" PlaceholderButton is
          // removed — the table already provides a working text search and an
          // All/Failures segmented filter. Export remains the browser print
          // (a real audited CSV export is a backend follow-up noted in the
          // gap report).
          <PrintExportButton label="Export" style={{ minHeight: 44 }} documentTitle="Audit Log" />
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="#f1f5f9" label="Events (24h)" value={errored ? "—" : last24h} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Success" value={errored ? "—" : successes} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Failures" value={errored ? "—" : failures} />
        {/* GAP-TENANT-ADMIN-AUDIT-04: these KPIs are computed from the events
            the list endpoint returned, which is a page of history, not the
            tenant's full total. Label it honestly as "Loaded events" until a
            server-side summary/total endpoint exists (see gap report). */}
        <StatCard icon="👥" iconBg="#eff6ff" label="Loaded events" value={errored ? "—" : loaded} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      {actionFilter && !errored && (
        <p role="status" style={{ fontSize: 13, marginBottom: 12 }}>
          Showing notification-preference changes only.{" "}
          <a className="link" href="/tenant-admin/audit">Show all audit events</a>
        </p>
      )}
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "audit events" })} backHref="/tenant-admin" />
      ) : (
        <AuditLogTable
          events={scoped.map((event) => ({
            id: event.id,
            timestamp: event.timestamp,
            actor: event.actor,
            ipAddress: event.ipAddress,
            action: event.action,
            resource: event.resource,
            outcome: event.outcome,
          }))}
        />
      )}
    </div>
  );
}
