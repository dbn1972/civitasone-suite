import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { getLeaveRequestDetails } from "../../../_data/loaders";
import type { LeaveRequestDetail } from "@civitasone/types";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { LEAVE_POLICY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { toHumanError } from "@/lib/messages";

/**
 * Mirrors leave/routes.ts HR_ROLES — the roles allowed to see ALL tenant
 * leave data. Employees see only their own applications; managers see their
 * direct reports (both enforced server-side — see GAP-HR-LEAVE-02/03/04).
 */
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_OR_MANAGER_ROLES = [...HR_ROLES, "manager"];

export default async function LeaveManagementPage() {
  const t = await getTranslations("leave");
  const roles = getSessionRoles();
  const isAdminOrManager = roles.some((r: string) => ADMIN_OR_MANAGER_ROLES.includes(r));
  const isAdmin = roles.some((r: string) => HR_ROLES.includes(r));
  // GAP-HR-LEAVE-POLICIES-01: the Policies link used to be gated on `isAdmin`
  // (hr_admin/hr_officer/super_admin — this page's own HR_ROLES), but the
  // destination page and backend only ever admitted hr_admin/super_admin/
  // "admin" — hr_officer cleared this gate and then hit a dead-end
  // PermissionDenied. Gate on the SAME shared constant leave-policies/
  // page.tsx and policy-admin-routes.ts actually enforce, so this link can
  // never again promise access the destination doesn't grant.
  const canManagePolicies = roles.some((r: string) => LEAVE_POLICY_ADMIN_ROLES.includes(r));

  const { data: allRequests, source } = await getLeaveRequestDetails();
  // GAP-HR-LEAVE-04: no client-side re-scoping here anymore. GET
  // /v1/hrms/leave-requests (leave/routes.ts) already applies
  // resolveLeaveReadScope server-side — HR sees the full tenant, a manager
  // sees their direct reports, a bare employee sees only their own linked
  // record (or nothing, if unlinked) — so re-filtering the already-scoped
  // response by a separately-fetched profile was redundant (an extra
  // request) and, for managers, was skipped entirely (isAdminOrManager
  // included "manager", so a manager's own rows were never narrowed
  // client-side even though the intent was "managers need the pending
  // queue", not "managers should see everyone"). Trust the server scope;
  // `roles` below is UI-only (which nav links/nudges to show).
  const leaveRequests = allRequests;

  const total = leaveRequests.length;
  const pending = leaveRequests.filter((r) => r.status === "pending").length;
  const approved = leaveRequests.filter((r) => r.status === "approved").length;
  const rejected = leaveRequests.filter((r) => r.status === "rejected").length;

  // GAP-HR-LEAVE-01: a failed fetch (source==='error') used to read as good
  // news — real zeros on every stat tile and DataTable's own "All clear — no
  // leave requests" empty state, both indistinguishable from a genuinely
  // empty, successful load. Gate on `errored` the same way loans/page.tsx
  // and locations/page.tsx already do: null stat values (StatCard renders a
  // dash) and a RefreshErrorState card instead of the table.
  const errored = source === "error";

  const columns: { key: keyof LeaveRequestDetail & string; label: string; align?: "left" | "right"; cellType?: "status" | "date" }[] = [
    { key: "employeeName", label: t("colEmployee") },
    { key: "leaveType", label: t("colLeaveType") },
    // GAP-HR-LEAVE-05: fromDate/toDate had no render/cellType, so DataTable's
    // default cellValue() printed the raw ISO string from the API. cellType
    // "date" renders via the shared formatIndianDate formatter (and is
    // exported to CSV the same way), matching every other date column in
    // this app.
    { key: "fromDate", label: t("colFromDate"), cellType: "date" },
    { key: "toDate", label: t("colToDate"), cellType: "date" },
    { key: "days", label: t("colDays"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel="HR"
        help="hr"
        actions={
          <>
            {/*
              GAP-HR-LEAVE-05: up to six action links/buttons in one row
              (Balance, History, Allocate, Policies, Approvals, New Leave)
              wrapped awkwardly on tablet/phone widths. Grouping the four
              secondary links in their own flex-wrap container (independent
              of whatever the shared .ph-act class does) guarantees they wrap
              onto their own line instead of overflowing, while Approvals and
              New Leave stay primary actions.
            */}
            <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Link href="/hr/leave/balance" className="btn">{t("navBalance")}</Link>
              <Link href="/hr/leave/history" className="btn">{t("navHistory")}</Link>
              {isAdmin && <Link href="/hr/leave/allocate" className="btn">{t("navAllocate")}</Link>}
              {canManagePolicies && <Link href="/hr/leave-policies" className="btn">{t("navPolicies")}</Link>}
            </span>
            {isAdminOrManager && <Link href="/hr/leave/approvals" className="btn">{t("approvals")}</Link>}
            <Link href="/hr/leave/apply" className="btn primary">{t("newLeave")}</Link>
          </>
        }
      />
      <DataSourceBadge source={source} />

      {/* Pending approval nudge — only shown to roles that can approve, and never on a failed load */}
      {!errored && isAdminOrManager && pending > 0 && (
        <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 8, background: "var(--warnbg)", border: "1px solid var(--warn)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true">⏳</span>
          <span><strong>{pending}</strong> {t("pendingSuffix", { count: pending })}</span>
          <Link href="/hr/leave/approvals" style={{ marginInlineStart: "auto", color: "var(--primary-d)", fontWeight: 500 }}>{t("reviewNow")}</Link>
        </div>
      )}

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--panel)" label={t("total")} value={errored ? null : total} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("pending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("approved")} value={errored ? null : approved} />
        <StatCard icon="❌" iconBg="var(--badbg)" label={t("rejected")} value={errored ? null : rejected} />
      </StatGrid>
      <Card title={t("requests")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "leave requests" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<LeaveRequestDetail>
            columns={columns}
            rows={leaveRequests}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🌴"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
            emptyAction={
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Link href="/hr/leave/apply" className="btn primary">{t("applyLeaveCta")}</Link>
                {isAdminOrManager && <Link href="/hr/leave/approvals" className="btn ghost">{t("viewApprovalsCta")}</Link>}
              </div>
            }
          />
        )}
      </Card>
    </div>
  );
}
