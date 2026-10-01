import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getEmployees, getMyProfile } from "../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { WFHRequestForm } from "../_components/WFHRequestForm";
import { WfhRequestsTable, type WfhRow } from "../_components/WfhRequestsTable";

/**
 * WfhPage — Work From Home requests: self-service create (any role) +
 * manager/HR approve-reject queue.
 *
 * CRITICAL fix: this page's only "+ New Request" button used to link to
 * /hr/workforce/wfh, which is role-gated to hr_admin/hr_officer/manager/
 * super_admin -- excluding `employee` entirely, even though WFH is
 * inherently self-initiated by the employee. Compounding: neither this page
 * nor /hr/workforce/wfh had any approve/reject control anywhere, despite
 * PATCH /v1/hrms/wfh-requests/:id/approve|reject already working (WAVE-4).
 * Fixed by embedding the existing WFHRequestForm directly here (mirroring
 * leave/apply/page.tsx's getEmployees-then-getMyProfile self-service
 * fallback, so a plain employee gets a prefilled, picker-free form instead
 * of a permission wall) and adding the same approve/reject action column
 * RegularisationTable already established for a sibling "manager decides
 * pending X" queue, via the shared WfhRequestsTable.
 */
const WFH_APPROVER_ROLES = ["hr_admin", "hr_officer", "manager", "super_admin"];

/**
 * GAP-HR-WFH-01 (partial — see routes.ts POST /wfh-requests for what's
 * enforced server-side and what's deliberately left open). Mon-Sun week
 * containing `dateStr`, in UTC — a client-side hint only (the server is
 * authoritative and uses the identical coarse boundary), not a display-facing
 * date computation.
 */
function isoWeekBoundsUtc(dateStr: string): { start: string; end: string } {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

/** Count of this employee's own pending/approved WFH requests whose fromDate falls in the current ISO week. */
function countWeeklyWfh(items: WfhRow[], employeeId: string | undefined): number | undefined {
  if (!employeeId) return undefined;
  const { start, end } = isoWeekBoundsUtc(new Date().toISOString().slice(0, 10));
  return items.filter((i) =>
    i.employeeId === employeeId &&
    (i.status === "pending" || i.status === "approved") &&
    i.fromDate >= start && i.fromDate <= end,
  ).length;
}

async function getData(): Promise<LoaderResult<WfhRow[]>> {
  return fetchJson<unknown, WfhRow[]>("/api/v1/hrms/wfh-requests", [], {
    telemetryKey: "hr.wfh-requests",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: WfhRow[] })?.data;
      if (!Array.isArray(arr)) return null;
      // Real shape from GET /v1/hrms/wfh-requests: { id, employeeId,
      // employeeName, fromDate, toDate, reason, status, createdAt }. There is
      // no `department` or `days` field -- this page's columns previously
      // named both anyway, so they always rendered blank.
      return arr.map((r) => ({
        ...r,
        employeeName: (r as Record<string, unknown>).employeeName as string ?? r.employeeId,
      }));
    },
  });
}

export default async function WfhPage() {
  const t = await getTranslations("wfhRequests");
  const { data: items, source } = await getData();
  const roles = getSessionRoles();
  const canApprove = roles.some((r: string) => WFH_APPROVER_ROLES.includes(r));

  // Self-service create, mirroring leave/apply/page.tsx exactly: try the
  // admin roster first (works for hr_admin/hr_officer/manager/super_admin --
  // lets them file a WFH request on behalf of any employee, same as
  // /hr/workforce/wfh already did). A plain `employee` role is correctly
  // 403'd from that endpoint (by design -- see READER_ROLES in hrms-service's
  // employee/routes.ts) and falls back to their own self-service profile, so
  // they get a prefilled form with the employee picker hidden entirely,
  // instead of the permission wall the old "+ New Request" button routed
  // them into.
  const { data: employees } = await getEmployees();
  let prefillEmployeeId: string | undefined;
  let noLinkedProfile = false;
  if (employees.length === 0) {
    const { data: myProfile } = await getMyProfile();
    if (myProfile) {
      prefillEmployeeId = myProfile.id;
    } else {
      // Genuinely no employee record linked to this account, and no roster
      // access either -- a normal, expected state (e.g. a pure admin/test
      // account), not a fetch failure. Show a clear message instead of a
      // form that can never be submitted.
      noLinkedProfile = true;
    }
  }

  const errored = source === "error";
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;
  // GAP-HR-WFH-01: lets the form's existing weekly-cap banner/submit-disable
  // actually fire instead of never receiving a count at all. Only computable
  // for the self-service prefill case — items is already scoped to "my own
  // requests" there (resolveSelfScopedEmployeeId), same scope this counts.
  const weeklyWfhCount = countWeeklyWfh(items, prefillEmployeeId);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏠" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApprovedLabel")} value={errored ? null : approved} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="❌" iconBg="var(--badbg, #fff0f0)" label={t("statRejectedLabel")} value={errored ? null : rejected} />
      </StatGrid>

      {/* GAP-HR-WORKFORCE-WFH-NEW-01: anchor target for /hr/workforce/wfh/new's
          redirect (and anyone else's deep link), which otherwise lands a
          visitor on this list page with no indication where the "new
          request" form they followed a /new link for actually is. */}
      <div id="new-request">
      <Card title={t("cardNewRequest")}>
        {noLinkedProfile ? (
          <div role="alert" style={{ padding: "20px 24px", fontSize: 13, color: "var(--warn-text, #92400e)" }}>
            {t("noLinkedProfileMessage")}
          </div>
        ) : (
          <WFHRequestForm employeeId={prefillEmployeeId} weeklyWfhCount={weeklyWfhCount} redirectHref="/hr/wfh" />
        )}
      </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title={t("cardTitle")}>
          {source === "error" ? (
            <RefreshErrorState error={toHumanError("load", { area: "WFH requests" })} backHref="/hr" />
          ) : (
            <WfhRequestsTable
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
