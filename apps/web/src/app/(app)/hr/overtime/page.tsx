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

async function getOvertimeRequests(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/overtime-requests", [], {
    telemetryKey: "overtime.list",
    mapResponse: (p) => {
      const arr = (p as Record<string, unknown>)?.data;
      return Array.isArray(arr) ? mapOvertime(arr as ApiOTRequest[]) : null;
    },
  });
}

export default async function OvertimePage() {
  const t = await getTranslations("overtime");
  const roles = getSessionRoles();
  const canDecide = roles.some((r) => OVERTIME_DECIDE_ROLES.includes(r));

  const result = await getOvertimeRequests();
  const requests = result.data;
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
<StatCard icon="⏱️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : requests.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="🕐" iconBg="var(--bg, #f5f5f5)" label={t("statApprovedHours")} value={errored ? null : `${approvedHrs.toFixed(2)} h`} />
      </StatGrid>
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
