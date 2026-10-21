import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getEmployees, getMyProfile } from "../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { WFHRequestForm } from "../_components/WFHRequestForm";
import { WfhRequestsTable, type WfhRow } from "../_components/WfhRequestsTable";
import { HR_STAFF_MANAGER_ROLES, HR_STAFF_ROLES, WFH_REQUEST_FILER_ROLES } from "@/lib/auth/workRoles";

/**
 * WfhPage — Work From Home requests: create (HR staff + employee roles; see
 * WFH_FILER_ROLES) + manager/HR approve-reject queue.
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
const WFH_APPROVER_ROLES = HR_STAFF_MANAGER_ROLES;

/**
 * GAP-HR-WFH-02: mirrors POST /v1/hrms/wfh-requests, which requires
 * [...HR_ROLES, "employee"]. A manager-only session can approve/reject its
 * team's requests below but cannot file one (the POST answers 403), so it is
 * shown an explanation instead of a form that can only fail.
 */
const WFH_FILER_ROLES = WFH_REQUEST_FILER_ROLES;
/** HR staff may file on behalf of any employee; everyone else files for themselves only. */
const WFH_FILE_FOR_OTHERS_ROLES = HR_STAFF_ROLES;

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
        employeeName: (r as Record<string, unknown>).employeeName as string ?? "—",
      }));
    },
  });
}

export default async function WfhPage() {
  const t = await getTranslations("wfhRequests");
  const { data: items, source } = await getData();
  const roles = getSessionRoles();
  const canApprove = roles.some((r: string) => WFH_APPROVER_ROLES.includes(r));

  // Self-service create. HR staff get the roster picker (file on behalf of
  // anyone, same as /hr/workforce/wfh always did); a plain `employee` -- with or
  // without a manager role on top -- is pinned to their own profile (the server
  // forces non-HR filers onto themselves, so a picker would only produce 403s),
  // which also gives them a prefilled, picker-free form. A role that cannot file
  // at all (manager-only) gets no form.
  const canFile = roles.some((r: string) => WFH_FILER_ROLES.includes(r));
  const canFileForOthers = roles.some((r: string) => WFH_FILE_FOR_OTHERS_ROLES.includes(r));
  let prefillEmployeeId: string | undefined;
  let noLinkedProfile = false;
  if (canFile) {
    const rosterEmpty = canFileForOthers ? (await getEmployees()).data.length === 0 : true;
    if (rosterEmpty) {
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
  }

  const errored = source === "error";
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;
  // The weekly-cap banner is NOT derived here: the form asks the server
  // (GET /v1/hrms/wfh-eligibility) for the figure it actually enforces on POST --
  // days used in the ISO week, not a count of request rows -- so the page and
  // the server cannot disagree.

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏠" iconBg="var(--infobg)" label={t("statTotalLabel")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApprovedLabel")} value={errored ? null : approved} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="❌" iconBg="var(--badbg)" label={t("statRejectedLabel")} value={errored ? null : rejected} />
      </StatGrid>

      {/* GAP-HR-WORKFORCE-WFH-NEW-01: anchor target for /hr/workforce/wfh/new's
          redirect (and anyone else's deep link), which otherwise lands a
          visitor on this list page with no indication where the "new
          request" form they followed a /new link for actually is. */}
      <div id="new-request">
      <Card title={t("cardNewRequest")}>
        {!canFile ? (
          <div role="note" style={{ padding: "20px 24px", fontSize: 13 }}>
            {t("noFilerRoleMessage")}
          </div>
        ) : noLinkedProfile ? (
          <div role="alert" style={{ padding: "20px 24px", fontSize: 13, color: "var(--warn-text)" }}>
            {t("noLinkedProfileMessage")}
          </div>
        ) : (
          <WFHRequestForm employeeId={prefillEmployeeId} redirectHref="/hr/wfh" />
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
