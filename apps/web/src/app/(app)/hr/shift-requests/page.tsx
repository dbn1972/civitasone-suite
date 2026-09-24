import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getEmployees, getMyProfile } from "../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { ShiftChangeRequestForm } from "../_components/ShiftChangeRequestForm";
import { ShiftRequestsTable, type ShiftRequestRow } from "../_components/ShiftRequestsTable";

/**
 * ShiftRequestsPage — employee requests to swap/change shift.
 * Maker-checker: employee submits → supervisor approves.
 * GoI context: shift changes must be approved per DoPT staffing guidelines.
 *
 * CRITICAL fix: this entire feature was previously view-only -- a real list
 * + stat cards backed by a real working GET /v1/hrms/shift-requests, but no
 * creation route (no `new/` subpath existed on disk), no button anywhere
 * linking to one, and no action column -- despite POST
 * /v1/hrms/shift-requests and the approve/reject routes already working
 * (WAVE-4). Fixed by adding a real create form (self-service, mirroring
 * /hr/wfh's getEmployees-then-getMyProfile resolution so a plain employee
 * gets a prefilled, picker-free form) and a manager/HR approve-reject
 * action column (ShiftRequestsTable, mirroring WfhRequestsTable).
 */

type Row = ShiftRequestRow;

async function getData(): Promise<LoaderResult<Row[]>> {
  // Real shape from GET /v1/hrms/shift-requests: { id, employeeId,
  // employeeName, currentShift, requestedShift, effectiveDate, reason,
  // status, createdAt }. There is no `department` field.
  return fetchJson<unknown, Row[]>("/api/v1/hrms/shift-requests", [], {
    telemetryKey: "hr.shift-requests",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({
        ...r,
        employeeName: (r as Record<string, unknown>).employeeName as string ?? r.employeeId,
        reason: r.reason ?? "—",
      }));
    },
  });
}

const SHIFT_APPROVER_ROLES = ["hr_admin", "hr_officer", "manager", "super_admin"];

export default async function ShiftRequestsPage() {
  const t = await getTranslations("shiftRequests");
  const { data: items, source } = await getData();
  const roles = getSessionRoles();
  const canApprove = roles.some((r: string) => SHIFT_APPROVER_ROLES.includes(r));

  // Self-service create, mirroring /hr/wfh and leave/apply/page.tsx: try the
  // admin roster first (works for hr_admin/hr_officer/super_admin -- lets
  // them file a shift-change request on behalf of any employee). A plain
  // `employee` role is correctly 403'd from that endpoint and falls back to
  // their own self-service profile, so they get a prefilled form with the
  // employee picker hidden entirely.
  const { data: employees } = await getEmployees();
  let prefillEmployeeId: string | undefined;
  let noLinkedProfile = false;
  if (employees.length === 0) {
    const { data: myProfile } = await getMyProfile();
    if (myProfile) {
      prefillEmployeeId = myProfile.id;
    } else {
      noLinkedProfile = true;
    }
  }

  const errored = source === "error";
  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🔄" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? "—" : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApprovedLabel")} value={errored ? "—" : approved} />
        <StatCard icon="❌" iconBg="var(--badbg, #fff0f0)" label={t("statRejectedLabel")} value={errored ? "—" : rejected} />
      </StatGrid>

      <Card title={t("cardNewRequest")}>
        {noLinkedProfile ? (
          <div role="alert" style={{ padding: "20px 24px", fontSize: 13, color: "var(--warn-text, #92400e)" }}>
            {t("noLinkedProfileMessage")}
          </div>
        ) : (
          <ShiftChangeRequestForm employeeId={prefillEmployeeId} redirectHref="/hr/shift-requests" />
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title={t("cardTitle")}>
          {source === "error" ? (
            <RefreshErrorState error={toHumanError("load", { area: "shift requests" })} backHref="/hr" />
          ) : (
            <ShiftRequestsTable
              rows={items}
              canApprove={canApprove}
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
