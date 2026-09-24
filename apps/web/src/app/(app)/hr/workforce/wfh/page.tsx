import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { WFHRequestForm } from "../../_components/WFHRequestForm";
import { WfhRequestsTable, type WfhRow } from "../../_components/WfhRequestsTable";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";

/**
 * WFHPage — Work From Home requests and approvals (HR/manager admin view:
 * file a request on behalf of any employee via the picker below).
 * DoPT WFH policy: max 2 days/week for eligible cadres.
 * Status chips: Pending / Approved / Rejected / Recalled.
 *
 * CRITICAL fix: this page had no approve/reject control anywhere despite
 * PATCH /v1/hrms/wfh-requests/:id/approve|reject already working (WAVE-4) --
 * added via the same WfhRequestsTable now shared with /hr/wfh (the
 * all-roles page a plain `employee` actually reaches; this page stays
 * role-gated as the HR/manager "file for anyone" tool).
 */

async function getData(): Promise<LoaderResult<WfhRow[]>> {
  return fetchJson<unknown, WfhRow[]>("/api/v1/hrms/wfh-requests", [], {
    telemetryKey: "hr.workforce.wfh",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: WfhRow[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({
        ...r,
        employeeName: (r as Record<string, unknown>).employeeName as string ?? r.employeeId,
      }));
    },
  });
}

const WFH_ALLOWED_ROLES = ["hr_admin", "hr_officer", "manager", "super_admin"];

export default async function WFHPage() {
  const roles = getSessionRoles();
  const canView = roles.some((r: string) => WFH_ALLOWED_ROLES.includes(r));

  if (!canView) {
    return <PermissionDenied module="Work From Home requests" requiredRoles={WFH_ALLOWED_ROLES} />;
  }

  const t = await getTranslations("workforceWfh");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;
  const recalled = items.filter((i) => i.status === "recalled").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/workforce" backLabel="Back to Workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏠" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalRequests")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="↩️" iconBg="var(--badbg, #fff0f0)" label={t("statRejectedRecalled")} value={errored ? null : rejected + recalled} />
      </StatGrid>

      <Card title={t("cardNewRequest")}>
        <WFHRequestForm redirectHref="/hr/workforce/wfh" />
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title={t("cardRequests")}>
          {errored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "wfh" })} backHref="/hr/workforce" />
            </div>
          ) : (
            <WfhRequestsTable
              rows={items}
              canApprove
              filterPlaceholder={t("filterPlaceholder")}
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
