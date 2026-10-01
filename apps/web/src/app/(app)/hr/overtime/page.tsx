import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { OvertimeTable } from "./OvertimeTable";
import { mapOvertime, sumHoursHundredths, type ApiOTRequest, type Row } from "./mapOvertime";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

// GAP-HR-OVERTIME-01: only these roles may approve/reject -- mirrors the
// backend's own HR_ROLES for the approve/reject routes exactly
// (attendance/routes.ts).
const OVERTIME_DECIDE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

/**
 * GAP-HR-OVERTIME-04 (pagination half — the manager-scope half of this gap
 * was already closed server-side by resolveSelfScopedEmployeeId). The route
 * silently truncated at 200 rows with no signal at all; now it returns
 * hasMore/total alongside data, so the page can show an honest truncation
 * notice and compute "Total Requests" from the real total rather than
 * requests.length, which would otherwise undercount once truncated.
 */
type OvertimeData = { requests: Row[]; hasMore: boolean; total: number };

async function getOvertimeRequests(): Promise<LoaderResult<OvertimeData>> {
  return fetchJson<unknown, OvertimeData>("/api/v1/hrms/overtime-requests", { requests: [], hasMore: false, total: 0 }, {
    telemetryKey: "overtime.list",
    mapResponse: (p) => {
      const body = p as { data?: unknown; hasMore?: boolean; total?: number };
      const arr = body?.data;
      if (!Array.isArray(arr)) return null;
      const requests = mapOvertime(arr as ApiOTRequest[]);
      return { requests, hasMore: Boolean(body.hasMore), total: typeof body.total === "number" ? body.total : requests.length };
    },
  });
}

export default async function OvertimePage() {
  const t = await getTranslations("overtime");
  const roles = getSessionRoles();
  const canDecide = roles.some((r) => OVERTIME_DECIDE_ROLES.includes(r));

  const result = await getOvertimeRequests();
  const { requests, hasMore, total } = result.data;
  const errored = result.source === "error";
  const pending = requests.filter((r) => r.status === "pending").length;
  const approved = requests.filter((r) => r.status === "approved").length;

  // GAP-HR-OVERTIME-05/06: "Total Hours" used to sum every status (pending +
  // approved + rejected), overstating payable overtime; now only approved
  // hours count, summed as integer hundredths to avoid float drift.
  const approvedHrs = sumHoursHundredths(requests, (s) => s === "approved");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={
          <Link href="/hr/overtime/new" className="btn primary">{t("newRequest")}</Link>
        }
      />
      <DataSourceBadge source={result.source} />
      <StatGrid>
        {/* GAP-HR-OVERTIME-04: was requests.length, which silently undercounted
            once the 200-row cap truncated the page; `total` is the real,
            server-side count regardless of truncation. */}
        <StatCard icon="⏱️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : total} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="🕐" iconBg="var(--bg, #f5f5f5)" label={t("statApprovedHours")} value={errored ? null : `${approvedHrs.toFixed(2)} h`} />
      </StatGrid>
      {!errored && hasMore && (
        <p role="status" style={{ fontSize: 13, color: "var(--mut, #6b7280)", margin: "0 0 12px" }}>
          {t("truncatedNotice", { count: requests.length, total })}
        </p>
      )}
      <Card title={t("cardTitle")}>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "overtime requests" })} backHref="/hr" />
        ) : requests.length === 0 ? (
          <EmptyState
            icon="⏱️"
            title={t("noRequestsTitle")}
            message={t("noRequestsMessage")}
            action={<Link href="/hr/overtime/new" className="btn primary">{t("newRequest")}</Link>}
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
    </div>
  );
}
