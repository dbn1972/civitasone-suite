import Link from "next/link";
import { PageHeader, Card, DataTable, LoadErrorState } from "@/app/_components/ds";
import { getHrAuditLog } from "@/app/_data/loaders";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "@/app/_components/PermissionDenied";

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

type SearchParams = { page?: string; from?: string; to?: string };

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
  const result = await getHrAuditLog(PAGE_SIZE + 1, offset, { from, to });
  const { data: events, source, status, errorMessage } = result;
  const errored = source === "error";
  const hasNext = !errored && events.length > PAGE_SIZE;
  const pageEvents = errored ? [] : events.slice(0, PAGE_SIZE);

  const rows = pageEvents.map((e, i) => ({
    id: String(offset + i),
    action: e.action,
    resource: e.resource === "unknown" ? t("unknownResource") : e.resource,
    actor: e.actor,
    outcome: e.outcome,
    at: e.at ?? null,
  }));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    params.set("page", String(p));
    if (searchParams?.from) params.set("from", searchParams.from);
    if (searchParams?.to) params.set("to", searchParams.to);
    return `/hr/audit-log?${params.toString()}`;
  };
  const hasDateFilter = Boolean(searchParams?.from || searchParams?.to);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />

      {/* GAP-HR-AUDIT-LOG-07: date range now actually narrows the query
          server-side -- the backend already accepted from/to, nothing on
          this page ever sent them. An actor free-text filter is NOT
          included here: it would need a small backend addition (matching
          the actor JSONB column) not made in this pass -- the existing
          per-page quick filter below still searches actor/action/resource
          text within whatever page is currently on screen. */}
      <form method="GET" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "0 0 16px" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="audit-log-from" style={{ fontSize: 12, fontWeight: 600 }}>{t("fromLabel")}</label>
          <input id="audit-log-from" type="date" name="from" defaultValue={searchParams?.from ?? ""} />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="audit-log-to" style={{ fontSize: 12, fontWeight: 600 }}>{t("toLabel")}</label>
          <input id="audit-log-to" type="date" name="to" defaultValue={searchParams?.to ?? ""} />
        </div>
        <button type="submit" className="btn">{t("applyFilter")}</button>
        {hasDateFilter && (
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
            <DataTable
              columns={[
                { key: "at", label: t("colWhen"), cellType: "datetime" },
                { key: "action", label: t("colAction") },
                { key: "resource", label: t("colResource") },
                { key: "actor", label: t("colActor") },
                { key: "outcome", label: t("colOutcome"), cellType: "status" },
              ]}
              rows={rows}
              sortable
              filterable
              filterPlaceholder={t("filterPlaceholder")}
              exportable
              exportFilename="hr-audit-log"
              emptyIcon="📋"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
              caption={t("cardTitle")}
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
