import Link from "next/link";
import { PageHeader, Card, LoadErrorState } from "@/app/_components/ds";
import { AuditLogTable } from "./AuditLogTable";
import { getHrAuditLog } from "@/app/_data/loaders";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { humanizeStatus } from "@/lib/formatters";
import { HR_AUDIT_RESOURCE_TYPES, resourceHref, resourceLabel } from "./auditResource";

/**
 * Mirrors services/audit-service/src/modules/events/routes.ts's role guard
 * on GET /audit/events (and /v1/audit/events) exactly -- audit trail access
 * is restricted to dedicated audit roles and platform/super admins, NOT the
 * general hr_admin/hr_officer roles used elsewhere under /hr. A plain HR
 * admin has neither audit_officer nor audit_admin and would get a 403 from
 * the backend despite this page otherwise rendering fine for them.
 */
const AUDIT_LOG_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin"];

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = { page?: string; from?: string; to?: string; resourceType?: string; actor?: string };

/** Plain `yyyy-mm-dd` from an `<input type="date">` -> an ISO instant, to
 * match the backend's `z.string().datetime()` from/to params. */
function parseDateStart(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
function parseDateEnd(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T23:59:59.999Z`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default async function HrAuditLogPage({ searchParams }: { searchParams?: SearchParams }) {
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => AUDIT_LOG_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="the audit log" requiredRoles={AUDIT_LOG_ROLES} />;
  }

  const t = await getTranslations("hrAuditLog");
  const pageNum = Math.max(1, Number(searchParams?.page) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;
  const from = parseDateStart(searchParams?.from);
  const to = parseDateEnd(searchParams?.to);

  // GAP-HR-AUDIT-LOG-04: request one row past the page size so a "next page
  // exists" signal is available without a backend total-count change --
  // trimmed back to PAGE_SIZE before rendering. Compliance risk this closes:
  // auditors could never before reach anything past the first 50 events,
  // full stop, and the CSV export (still current-page-only, see below)
  // silently covered only those same 50 with no indication more existed.
  // GAP-HR-AUDIT-LOG-07: resource type + actor now narrow the query
  // server-side (audit-service ?resourceType=/?actor=), across all pages.
  const resourceType = (HR_AUDIT_RESOURCE_TYPES as readonly string[]).includes(searchParams?.resourceType ?? "")
    ? searchParams?.resourceType
    : undefined;
  const actor = searchParams?.actor?.trim().slice(0, 128) || undefined;
  const result = await getHrAuditLog(PAGE_SIZE + 1, offset, { from, to, resourceType, actor });
  const { data: events, source, status, errorMessage } = result;
  const errored = source === "error";
  const hasNext = !errored && events.length > PAGE_SIZE;
  const pageEvents = errored ? [] : events.slice(0, PAGE_SIZE);

  // GAP-HR-AUDIT-LOG-05: "Type · id" (so the CSV export carries the id too)
  // and a row link to the entity's page for the types that have one.
  const rows = pageEvents.map((e, i) => ({
    id: String(offset + i),
    action: e.action,
    resource: resourceLabel(e.resourceType, e.resourceId, humanizeStatus) ?? (e.resource === "unknown" ? t("unknownResource") : e.resource),
    href: resourceHref(e.resourceType, e.resourceId) ?? null,
    actor: e.actor,
    outcome: e.outcome,
    at: e.at ?? null,
  }));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    params.set("page", String(p));
    if (searchParams?.from) params.set("from", searchParams.from);
    if (searchParams?.to) params.set("to", searchParams.to);
    if (resourceType) params.set("resourceType", resourceType);
    if (actor) params.set("actor", actor);
    return `/hr/audit-log?${params.toString()}`;
  };
  const hasFilter = Boolean(searchParams?.from || searchParams?.to || resourceType || actor);

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />

      {/* GAP-HR-AUDIT-LOG-07: date range, resource type and actor all narrow
          the query server-side (so they apply across every page, not just
          the 50 rows on screen). The DataTable's own text box below is a
          within-page quick filter only. */}
      <form method="GET" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "0 0 16px" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="audit-log-from" style={{ fontSize: 12, fontWeight: 600 }}>{t("fromLabel")}</label>
          <input id="audit-log-from" type="date" name="from" defaultValue={searchParams?.from ?? ""} />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="audit-log-to" style={{ fontSize: 12, fontWeight: 600 }}>{t("toLabel")}</label>
          <input id="audit-log-to" type="date" name="to" defaultValue={searchParams?.to ?? ""} />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="audit-log-resource-type" style={{ fontSize: 12, fontWeight: 600 }}>{t("resourceTypeLabel")}</label>
          <select id="audit-log-resource-type" name="resourceType" defaultValue={resourceType ?? ""}>
            <option value="">{t("allResourceTypes")}</option>
            {HR_AUDIT_RESOURCE_TYPES.map((rt) => (
              <option key={rt} value={rt}>{humanizeStatus(rt)}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="audit-log-actor" style={{ fontSize: 12, fontWeight: 600 }}>{t("actorLabel")}</label>
          <input id="audit-log-actor" type="search" name="actor" maxLength={128} defaultValue={actor ?? ""} placeholder={t("actorPlaceholder")} />
        </div>
        <button type="submit" className="btn">{t("applyFilter")}</button>
        {hasFilter && (
          <Link href="/hr/audit-log" className="btn ghost">{t("clearFilter")}</Link>
        )}
      </form>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState
              result={{ status, errorMessage }}
              area="audit log"
              backHref="/hr"
              requiredRoles={AUDIT_LOG_ROLES}
            />
          </div>
        ) : (
          <>
            <AuditLogTable
              rows={rows}
              labels={{
                when: t("colWhen"),
                action: t("colAction"),
                resource: t("colResource"),
                actor: t("colActor"),
                outcome: t("colOutcome"),
                filterPlaceholder: t("filterPlaceholder"),
                emptyTitle: t("emptyTitle"),
                emptyMessage: t("emptyMessage"),
                caption: t("cardTitle"),
              }}
            />
            {pageEvents.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--mut,#64748b)" }}>
                <span>{t("showingRange", { from: offset + 1, to: offset + pageEvents.length })}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {pageNum > 1 && <Link href={pageHref(pageNum - 1)} className="btn ghost">{t("prevPage")}</Link>}
                  {hasNext && <Link href={pageHref(pageNum + 1)} className="btn ghost">{t("nextPage")}</Link>}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
