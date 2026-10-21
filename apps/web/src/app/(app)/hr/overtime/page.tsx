import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { OvertimeTable } from "./OvertimeTable";
import { mapOvertime, sumHoursHundredths, type ApiOTRequest, type Row } from "./mapOvertime";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { HR_STAFF_ROLES, OVERTIME_REQUEST_ROLES } from "@/lib/auth/workRoles";
import { Pager } from "../payroll/pay-groups/Pager";
import { parseOffset } from "../payroll/pay-groups/payGroupMembership";

// GAP-HR-OVERTIME-01: only these roles may approve/reject -- mirrors the
// backend's own HR_ROLES for the approve/reject routes exactly
// (attendance/routes.ts).
const OVERTIME_DECIDE_ROLES = HR_STAFF_ROLES;

/** Rows per server page. Equals the table's own page size, so the table never paginates a second time inside a server page. */
const PAGE_SIZE = 20;

/**
 * GAP-HR-OVERTIME-04 (pagination half — the manager-scope half of this gap
 * was already closed server-side by resolveSelfScopedEmployeeId). The route
 * silently truncated at 200 rows with no signal at all; now it returns
 * hasMore/total alongside data, so the page can show an honest truncation
 * notice and compute "Total Requests" from the real total rather than
 * requests.length, which would otherwise undercount once truncated.
 *
 * Rescan: the page now asks for one server page at a time (limit/offset from
 * `?offset=`), so every row is reachable, and takes Pending / Approved /
 * Approved Hours from the route's server-side `summary` (the whole scoped
 * list) instead of counting the rows of the loaded window.
 */
type OvertimeSummary = { total: number; pending: number; approved: number; rejected: number; approvedHours: number };
type OvertimeData = { requests: Row[]; hasMore: boolean; total: number; summary: OvertimeSummary | null };

function readSummary(raw: unknown): OvertimeSummary | null {
  const r = raw as Partial<Record<keyof OvertimeSummary, unknown>> | null | undefined;
  if (!r) return null;
  const keys: Array<keyof OvertimeSummary> = ["total", "pending", "approved", "rejected", "approvedHours"];
  if (!keys.every((k) => typeof r[k] === "number" && Number.isFinite(r[k] as number))) return null;
  return {
    total: r.total as number, pending: r.pending as number, approved: r.approved as number,
    rejected: r.rejected as number, approvedHours: r.approvedHours as number,
  };
}

async function getOvertimeRequests(offset: number): Promise<LoaderResult<OvertimeData>> {
  return fetchJson<unknown, OvertimeData>(
    `/api/v1/hrms/overtime-requests?limit=${PAGE_SIZE}&offset=${offset}`,
    { requests: [], hasMore: false, total: 0, summary: null },
    {
      telemetryKey: "overtime.list",
      mapResponse: (p) => {
        const body = p as { data?: unknown; hasMore?: boolean; total?: number; summary?: unknown };
        const arr = body?.data;
        if (!Array.isArray(arr)) return null;
        const requests = mapOvertime(arr as ApiOTRequest[]);
        return {
          requests,
          hasMore: Boolean(body.hasMore),
          total: typeof body.total === "number" ? body.total : requests.length,
          summary: readSummary(body.summary),
        };
      },
    },
  );
}

export default async function OvertimePage({ searchParams }: { searchParams?: { offset?: string } }) {
  const t = await getTranslations("overtime");
  const roles = getSessionRoles();
  const canDecide = roles.some((r) => OVERTIME_DECIDE_ROLES.includes(r));
  // GAP-HR-OVERTIME-03: POST /v1/hrms/overtime-requests excludes a bare
  // manager (403), so the New Request entry points are not offered to one.
  const canRequest = roles.some((r) => OVERTIME_REQUEST_ROLES.includes(r));
  const offset = parseOffset(searchParams?.offset);

  const result = await getOvertimeRequests(offset);
  const { requests, hasMore, total, summary } = result.data;
  const errored = result.source === "error";
  // GAP-HR-OVERTIME-04: the whole scoped list's figures come from the
  // server-side summary; only a service that does not send one yet falls
  // back to counting the loaded window.
  const pending = summary ? summary.pending : requests.filter((r) => r.status === "pending").length;
  const approved = summary ? summary.approved : requests.filter((r) => r.status === "approved").length;

  // GAP-HR-OVERTIME-05/06: "Total Hours" used to sum every status (pending +
  // approved + rejected), overstating payable overtime; now only approved
  // hours count, summed as integer hundredths to avoid float drift.
  const approvedHrs = summary ? summary.approvedHours : sumHoursHundredths(requests, (s) => s === "approved");
  const newRequestLink = canRequest ? <Link href="/hr/overtime/new" className="btn primary">{t("newRequest")}</Link> : undefined;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={newRequestLink}
      />
      <DataSourceBadge source={result.source} />
      <StatGrid>
        {/* GAP-HR-OVERTIME-04: was requests.length, which silently undercounted
            once the 200-row cap truncated the page; `total` is the real,
            server-side count regardless of truncation. */}
        <StatCard icon="⏱️" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : total} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="🕐" iconBg="var(--bg)" label={t("statApprovedHours")} value={errored ? null : `${approvedHrs.toFixed(2)} h`} />
      </StatGrid>
      {!errored && hasMore && offset === 0 && (
        <p role="status" style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 12px" }}>
          {t("truncatedNotice", { count: requests.length, total })}
        </p>
      )}
      <Card title={t("cardTitle")}>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "overtime requests" })} backHref="/hr" />
        ) : requests.length === 0 && total > 0 ? (
          // A page past the end (stale link / list shrank): not "no requests".
          <EmptyState
            icon="⏱️"
            title={t("pageEmptyTitle")}
            message={t("pageEmptyMessage")}
            action={<Link href="/hr/overtime" className="btn primary">{t("backToFirstPage")}</Link>}
          />
        ) : requests.length === 0 ? (
          <EmptyState
            icon="⏱️"
            title={t("noRequestsTitle")}
            message={canRequest ? t("noRequestsMessage") : t("noRequestsMessageNoRequest")}
            action={newRequestLink}
          />
        ) : (
          <OvertimeTable
            rows={requests}
            canDecide={canDecide}
            filterPlaceholder={t("filterPlaceholder")}
            emptyIcon="⏱️"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
            labels={{
              employee: t("colEmployee"),
              date: t("colDate"),
              hours: t("colHours"),
              reason: t("colReason"),
              status: t("colStatus"),
              actions: t("colActions"),
            }}
          />
        )}
      </Card>
      {!errored && total > PAGE_SIZE && (
        <Pager
          total={total}
          limit={PAGE_SIZE}
          offset={offset}
          hrefFor={(o) => (o > 0 ? `/hr/overtime?offset=${o}` : "/hr/overtime")}
        />
      )}
    </div>
  );
}
