import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, RefreshErrorState } from "../../../_components/ds";
import { getTenantAuditLog, getTenantAuditSummary } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { countLast24h } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { AuditLogTable } from "./AuditLogTable";

export default async function TenantAuditPage({ searchParams }: { searchParams?: { entity?: string } }) {
  const t = await getTranslations("tenantAdminW2.audit");
  const [result, summaryResult] = await Promise.all([getTenantAuditLog(), getTenantAuditSummary()]);
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

  // GAP-TENANT-ADMIN-AUDIT-04/-06: whole-history counts come from the server
  // summary (audit-service /v1/audit/events/summary), not from the size of the
  // page the list returned. When the summary is unavailable the tiles show an em dash,
  // never a number derived from the loaded page. A scoped view (?entity=) is a
  // subset the summary cannot describe, so it falls back to the loaded rows.
  const serverSummary = !actionFilter && summaryResult.source !== "error" ? summaryResult.data : null;
  const summaryUnavailable = !actionFilter && serverSummary === null;
  // GAP-TENANT-ADMIN-AUDIT-01: rolling 24h window (not a UTC calendar day).
  const last24h = countLast24h(scoped);
  const loaded = scoped.length;
  const successes = scoped.filter((e) => e.outcome === "success").length;
  const failures = scoped.filter((e) => e.outcome === "failure").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Audit Log"
        subtitle="Tenant-scoped audit events — all actor actions and outcomes."
      />
      {/* The summary tiles are whole-tenant totals from the server; "Loaded events"
          is honestly just the rows in the table below. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        {actionFilter ? null : (
          <StatCard icon="🗂️" tone="neutral" label={t("total")} value={errored || summaryUnavailable ? t("noValue") : serverSummary!.total} />
        )}
        <StatCard icon="📋" tone="neutral" label={t("last24h")} value={errored ? t("noValue") : actionFilter ? last24h : summaryUnavailable ? t("noValue") : serverSummary!.last24h} />
        <StatCard icon="✅" tone="good" label={t("success")} value={errored ? t("noValue") : actionFilter ? successes : summaryUnavailable ? t("noValue") : serverSummary!.success} />
        <StatCard icon="❌" tone="bad" label={t("failures")} value={errored ? t("noValue") : actionFilter ? failures : summaryUnavailable ? t("noValue") : serverSummary!.failures} />
        <StatCard icon="👥" tone="neutral" label={t("loaded")} value={errored ? t("noValue") : loaded} />
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
