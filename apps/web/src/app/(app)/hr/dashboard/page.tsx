export const dynamic = "force-dynamic";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { RefreshErrorState, StatusPill } from "../../../_components/ds";
import {
  getHRDashboard, getEmployees, getDashboardLeaveInbox, getMyProfile,
  getMyLeaveBalance, getMyAttendance, getMyLeaveApplications,
} from "../../../_data/loaders";
import { getSessionName, getSessionRoles } from "../../../../lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, humanizeStatus, greetingForHour, currentIstHour } from "@/lib/formatters";
import { GreetingHeader } from "./_components/GreetingHeader";
import { HRKPIStrip } from "./_components/HRKPIStrip";
import { MyKPIStrip } from "./_components/MyKPIStrip";
import { ActionInbox } from "./_components/ActionInbox";
import { MyLeaveStatusPanel } from "./_components/MyLeaveStatusPanel";
import { DeptHeadcountChart } from "./_components/DeptHeadcountChart";
import { QuickActionsPanel } from "./_components/QuickActionsPanel";
import { PayrollBanner } from "./_components/PayrollBanner";

/**
 * Mirrors hrms-service dashboard/routes.ts's READER_ROLES exactly: the same
 * set of roles for whom GET /v1/hrms/dashboard and GET
 * /v1/hrms/dashboard/pending-leaves actually succeed. Anyone else (in
 * practice, a plain "employee") got a 403 from both -- root cause of the
 * "HR Dashboard is completely broken for the employee role" bug: this page
 * used to call those two admin-wide endpoints unconditionally regardless of
 * viewer role, so every KPI tile / the pending-actions banner / the whole
 * page-level badge went honest-blank (correctly, given the loader
 * contract -- but for EVERY plain employee, on EVERY load, which is not a
 * "degraded" dashboard, it is a non-functional one).
 *
 * Gating here means a non-admin viewer's page never makes those two calls
 * in the first place, and instead sees content actually scoped to them --
 * their own leave balance, attendance and requests (see the isHRStaff
 * branch below) -- the same "render differently for a non-admin instead of
 * just having the data calls fail" responsibility hr/layout.tsx's own
 * HR_ROLES comment already documents as each page's job (hr/payroll/page.tsx
 * does the analogous thing with its own canAdminister flag).
 */
const HR_DASHBOARD_READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

/**
 * Mirrors hr/employees/new/page.tsx's EMPLOYEE_ADMIN_ROLES exactly (that
 * page's own POST /v1/hrms/employees gate). Deliberately narrower than
 * HR_DASHBOARD_READER_ROLES above: "manager" can read this dashboard (and
 * so reaches the isHRStaff branch below, not the plain-employee one) but
 * cannot create an employee -- the branch below used to hand every
 * isHRStaff viewer the same admin-shaped GreetingHeader/QuickActionsPanel
 * regardless, so a manager saw a fully working "+ Add Employee" action
 * that led straight to that page's PermissionDenied wall. Same bug class
 * the employee branch just below already avoids for plain "employee".
 */
const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

// GAP-HR-DASHBOARD-05: mirrors hr/payroll/page.tsx's own PAYROLL_ADMIN_ROLES
// exactly (that page's own canAdminister flag, which hides its run-payroll
// form for anyone outside this set). Deliberately its own constant, not a
// reuse of EMPLOYEE_ADMIN_ROLES above: payroll administration and employee
// administration are different privileges in this app's role model, even
// though both happen to be held by hr_admin/super_admin today.
const PAYROLL_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

type EmpRow = {
  id: string;
  name: string;
  department: string;
  status: string;
  employeeNo?: string;
  dateOfJoining?: string;
  payGrade?: string;
} & Record<string, unknown>;

// GAP-HR-DASHBOARD-09: pre-existing rotating avatar-tint palette, wrapped in
// var(--token, #same-fallback) instead of bare hex -- identical rendering
// (no token is defined anywhere, so every fallback renders exactly as
// before), just no longer a bare-hex literal. Duplicated from
// ActionInbox.tsx's own AVATAR_BG/FG (both flagged by the same gap) rather
// than shared, matching this file's existing "each own copy" convention.
const AVATAR_BG = ["var(--dash-avatar-bg-1, #dbeafe)", "var(--dash-avatar-bg-2, #fce7f3)", "var(--dash-avatar-bg-3, #d1fae5)", "var(--dash-avatar-bg-4, #fef3c7)", "var(--dash-avatar-bg-5, #e0e7ff)", "var(--dash-avatar-bg-6, #fee2e2)"];
const AVATAR_FG = ["var(--dash-avatar-fg-1, #1e40af)", "var(--dash-avatar-fg-2, #9d174d)", "var(--dash-avatar-fg-3, #065f46)", "var(--dash-avatar-fg-4, #92400e)", "var(--dash-avatar-fg-5, #3730a3)", "var(--dash-avatar-fg-6, #991b1b)"];

function payrollDaysLeft(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.getDate() - now.getDate();
}

function formatToday(): { today: string; dayName: string; monthName: string } {
  const d = new Date();
  return {
    today: d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
    dayName: d.toLocaleDateString("en-IN", { weekday: "long" }),
    monthName: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
  };
}

export default async function HRDashboardPage() {
  const roles = getSessionRoles();
  const isHRStaff = roles.some((r) => HR_DASHBOARD_READER_ROLES.includes(r));

  const t = await getTranslations();
  const daysLeft = payrollDaysLeft();
  const { today, dayName, monthName } = formatToday();
  const sessionName = getSessionName();

  if (!isHRStaff) {
    const [profileResult, balanceResult, attendanceResult, myAppsResult] = await Promise.all([
      getMyProfile(),
      getMyLeaveBalance(),
      getMyAttendance(31),
      getMyLeaveApplications(),
    ]);

    const profile = profileResult.data;
    const userName = sessionName ? sessionName.split(" ")[0] : (profile ? profile.name.split(" ")[0] : "there");

    // Same "narrow per-widget honest-blank, broad page-level badge" split
    // as the HR-staff branch below: profileResult's normalized 404 (no
    // linked employee record) is not counted as an error here either, for
    // the same reason getMyProfile()'s own doc comment gives.
    const anyError =
      profileResult.source === "error" ||
      balanceResult.source === "error" ||
      attendanceResult.source === "error" ||
      myAppsResult.source === "error";

    const balanceFailed = balanceResult.source === "error";
    const attendanceFailed = attendanceResult.source === "error";
    const myAppsFailed = myAppsResult.source === "error";

    const leaveBalanceDays = balanceFailed ? null : balanceResult.data.reduce((sum, a) => sum + a.balance, 0);
    // An empty attendance list reads as "no data yet" (new joinee, sync not
    // run today), not a genuine 0% -- same fabricated-zero-vs-honest-absence
    // guard as HRKPIStrip.tsx's hasValue(), just applied to a ratio instead
    // of a passed-through count.
    const attendanceThisMonthPct = attendanceFailed || attendanceResult.data.length === 0 // ux-001-ok: attendanceFailed IS attendanceResult.source === "error" (aliased above) -- already gated, the guard's text-only match just can't see through the identifier
      ? null
      : Math.round((attendanceResult.data.filter((a) => a.status === "present").length / attendanceResult.data.length) * 100);
    const pendingCount = myAppsFailed ? null : myAppsResult.data.filter((a) => a.status === "pending").length;
    const routingFailedCount = myAppsFailed ? null : myAppsResult.data.filter((a) => a.status === "routing_failed").length;
    // GAP-HR-DASHBOARD-03: humanizeStatus (the same helper StatusPill.tsx
    // itself uses) covers every EMPLOYEE_STATUSES value with a real,
    // distinct label -- the previous statusLabel() hardcoded "Confirmed" for
    // every status besides probation/on_leave (suspended, deputation,
    // retired, separated, terminated all rendered as "Confirmed").
    const employmentStatusLabel = profile ? humanizeStatus(profile.status) : null;

    const myRecentApps = myAppsFailed
      ? []
      : myAppsResult.data
          .slice()
          .sort((a, b) => b.fromDate.localeCompare(a.fromDate))
          .slice(0, 5)
          .map((a) => ({ id: a.id, fromDate: a.fromDate, toDate: a.toDate, days: a.days, status: a.status }));

    return (
      <div
        className="hr-dashboard-root"
        aria-labelledby="hr-dash-heading"
        style={{ background: "var(--page-bg,#eef2f7)", minHeight: "100vh" }}
      >
        <h1 id="hr-dash-heading" className="sr-only">{t("dashboard.title")}</h1>
        {anyError && <DataSourceBadge source="error" />}

        <GreetingHeader
          userName={userName}
          greeting={greetingForHour(currentIstHour())}
          pendingCount={routingFailedCount}
          payrollDaysLeft={daysLeft}
          today={today}
          dayName={dayName}
          actions={[
            { label: "Apply for Leave", href: "/hr/leave/apply", primary: true },
            { label: "My Leave History", href: "/hr/leave/history" },
          ]}
        />

        <MyKPIStrip
          leaveBalanceDays={leaveBalanceDays}
          pendingCount={pendingCount}
          routingFailedCount={routingFailedCount}
          attendanceThisMonthPct={attendanceThisMonthPct}
          employmentStatusLabel={employmentStatusLabel}
        />

        <div className="dash-body-grid">
          <div className="dash-col-left">
            {myAppsFailed ? (
              <RefreshErrorState error={toHumanError("load", { area: "your leave applications" })} />
            ) : (
              <MyLeaveStatusPanel items={myRecentApps} />
            )}
          </div>
          <div className="dash-col-right">
            <QuickActionsPanel variant="employee" myEmployeeId={profile?.id ?? null} />
          </div>
        </div>

        <style>{`
          .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0; }
          .dash-body-grid { display:grid;grid-template-columns:1fr 260px;gap:12px;padding:0 24px 32px; }
          .dash-col-left,.dash-col-right { min-width:0; }
          @media (max-width:900px) { .dash-body-grid { grid-template-columns:1fr;padding:0 16px 24px; } }
        `}</style>
      </div>
    );
  }

  const [dashResult, empResult, inboxResult, profileResult] = await Promise.all([
    getHRDashboard(),
    getEmployees(8),
    getDashboardLeaveInbox(),
    getMyProfile(),
  ]);

  const { data, source } = dashResult;
  const employees = empResult.data as EmpRow[];
  const leaveInbox = inboxResult.data.data;
  const routingFailedItems = inboxResult.data.routingFailed;
  const profile = profileResult.data;

  // GAP-HR-DASHBOARD-02: getDashboardLeaveInbox() now surfaces a real
  // `source` (previously swallowed internally, so this page could never
  // tell a genuine load failure apart from a healthy empty inbox -- see
  // loaders.ts). inboxFailed is deliberately its own flag, not folded into
  // hrDashboardFailed: it gates ActionInbox/the routing-failed alert, which
  // render from inboxResult alone, the same "narrow per-widget flag" pattern
  // hrDashboardFailed/employeesFailed already use for their own widgets.
  //
  // profileResult specifically: a 404 on /hrms/me/profile ("no employee
  // record linked to your user") is a normal, expected state for an
  // admin/test account with no linked employee record -- getMyProfile()
  // itself now normalizes that one case to source:"api"/data:null (see
  // loaders.ts), so it never reaches here as an "error" in the first place.
  // Any OTHER profile failure (auth, network, 5xx) still counts, same as
  // dashResult/empResult.
  const inboxFailed = inboxResult.source === "error";
  const anyError =
    source === "error" ||
    empResult.source === "error" ||
    profileResult.source === "error" ||
    inboxFailed;
  // Narrower than anyError on purpose: the KPI strip only renders numbers
  // that came from dashResult, so it should only go honest-blank ("—") on
  // dashResult's own failure -- not, say, because the unrelated profile
  // fetch errored. HRKPIStrip's own headcount/pendingLeaves/etc. fields
  // still zero themselves internally on error (see HR_DASHBOARD_EMPTY in
  // loaders.ts); passing null here on a real dashResult failure is what
  // tells HRKPIStrip that zero was fabricated, not counted.
  const hrDashboardFailed = source === "error";
  // Same reasoning, for the employee table: it only renders empResult's own
  // rows, so it must only show the "couldn't load" error state on
  // empResult's own failure -- not because the unrelated dashboard summary
  // or profile fetch errored (that was this page's actual bug: the table
  // used the broad anyError and so kept showing "We couldn't load
  // employees" even when empResult had genuinely succeeded, purely because
  // profileResult's legitimate 404 kept anyError true).
  const employeesFailed = empResult.source === "error";
  const onLeaveCount = data.onLeave;

  const userName = sessionName ? sessionName.split(" ")[0] : (profile ? profile.name.split(" ")[0] : "there");
  const canManageEmployees = roles.some((r) => EMPLOYEE_ADMIN_ROLES.includes(r));
  // GAP-HR-DASHBOARD-05: mirrors hr/payroll/page.tsx's own canAdminister
  // check exactly (PAYROLL_ADMIN_ROLES above) -- gates whether PayrollBanner
  // shows a "Start Run" link a manager would only reach a dead-end
  // PermissionDenied wall from.
  const canRunPayroll = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));
  // GAP-HR-DASHBOARD-08: safe non-decision fallback -- whether a manager
  // should see tenant-wide KPIs/dept-chart/leave-inbox at all (vs scoped to
  // direct reports) is a real DPDP-relevant access decision this fix does
  // NOT make either way (see this cluster's PR description). Labeling makes
  // the existing (unchanged) scope honest/transparent instead of silently
  // implying it's "the manager's own" data.
  const isManagerOnlyViewer = !canManageEmployees;
  // GAP-HR-DASHBOARD-08: the server now narrows a manager-only viewer's
  // figures to their direct reports (dashboard_scope policy, default) and says
  // so in `data.scope`; the label follows what the server actually did, so it
  // can never claim "Organisation-wide" for scoped numbers or vice versa.
  const scopedToReports = data.scope === "direct_reports";

  const recentEmployees = employees;

  return (
    <div
      className="hr-dashboard-root"
      aria-labelledby="hr-dash-heading"
      style={{ background: "var(--page-bg,#eef2f7)", minHeight: "100vh" }}
    >
      <h1 id="hr-dash-heading" className="sr-only">{t("dashboard.title")}</h1>
      {anyError && <DataSourceBadge source="error" />}

      <GreetingHeader
        userName={userName}
        greeting={greetingForHour(currentIstHour())}
        pendingCount={hrDashboardFailed ? null : data.pendingLeaves}
        payrollDaysLeft={daysLeft}
        today={today}
        dayName={dayName}
        actions={
          canManageEmployees
            ? undefined
            : [
                // GAP-HR-DASHBOARD-06: was "/hr/payroll" -- not a report of
                // any kind, a dead-end link. /reports/list/new?reportType=hr
                // is a real, working report-generation flow (verified: the
                // generic reports pipeline's own form literally offers "hr"
                // as its example report-type value).
                { label: "Export Report", href: "/reports/list/new?reportType=hr" },
                { label: "View Employees", href: "/hr/employees" },
              ]
        }
      />

      {/* GAP-HR-DASHBOARD-08: safe non-decision fallback -- see
          isManagerOnlyViewer's doc comment above. Transparency only; does
          not change what data a manager can already see. */}
      {isManagerOnlyViewer && (
        <p data-testid="dashboard-scope-note"
          className="scope-note"
          style={{ margin: "0 24px 8px", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted,#64748b)" }}
        >
          {scopedToReports ? t("dashboard.scopeDirectReports") : t("dashboard.scopeOrganisationData")}
        </p>
      )}
      <HRKPIStrip
        headcount={hrDashboardFailed ? null : data.headcount}
        headcountLastMonth={hrDashboardFailed ? null : data.headcountLastMonth}
        pendingLeaves={hrDashboardFailed ? null : data.pendingLeaves}
        onLeave={hrDashboardFailed ? null : onLeaveCount}
        departments={hrDashboardFailed ? null : data.totalDepartments}
        attendanceTodayPct={hrDashboardFailed ? null : data.attendanceTodayPct}
        payrollDaysLeft={daysLeft}
      />

      {/* 3-column body */}
      <div className="dash-body-grid">
        {/* Left: routing-failure alert + action inbox + payroll banner */}
        <div className="dash-col-left">
          {/* GAP-HR-DASHBOARD-02: gated on inboxFailed (this alert's own
              data source), not hrDashboardFailed (an unrelated summary
              query) -- the previous gate was simply the wrong flag. */}
          {!inboxFailed && routingFailedItems.length > 0 && (
            <div className="routing-failed-alert" role="alert" data-testid="routing-failed-alert">
              <div className="rf-head">
                ⚠ {routingFailedItems.length} leave request{routingFailedItems.length !== 1 ? "s" : ""} could not be routed for approval
              </div>
              <ul className="rf-list">
                {routingFailedItems.map((item) => (
                  <li key={item.id}>
                    {item.employeeName} ({item.employeeNo}) · {item.fromDate}–{item.toDate} · {item.daysApplied} day{item.daysApplied !== 1 ? "s" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inboxFailed ? (
            <RefreshErrorState error={toHumanError("load", { area: "pending leave approvals" })} />
          ) : (
            <ActionInbox initialItems={leaveInbox} canDecide={canManageEmployees} />
          )}
          {/* GAP-HR-DASHBOARD-05: only surfaced once payroll is genuinely
              close (was unconditional on every HR-staff load); canRunPayroll
              hides "Start Run ->" for a manager who'd only reach a dead-end
              PermissionDenied wall from it. */}
          {daysLeft <= 7 && (
            <PayrollBanner
              daysLeft={daysLeft}
              monthName={monthName}
              headcount={hrDashboardFailed ? null : data.headcount}
              canRunPayroll={canRunPayroll}
            />
          )}
        </div>

        {/* Center: dept chart */}
        <div className="dash-col-center">
          <DeptHeadcountChart
            breakdown={data.departmentBreakdown}
            scopeNote={isManagerOnlyViewer ? (scopedToReports ? t("dashboard.scopeDirectReports") : t("dashboard.scopeOrganisation")) : undefined}
          />
        </div>

        {/* Right: quick actions */}
        <div className="dash-col-right">
          <QuickActionsPanel variant={canManageEmployees ? "admin" : "manager"} />
        </div>
      </div>

      {/* Rich employee table */}
      <section className="emp-section" aria-label="Recent employees">
        <div className="emp-section-head">
          <span className="emp-section-title">{t("employees.title")}</span>
          <Link href="/hr/employees" className="emp-view-all">View all {hrDashboardFailed ? "" : data.headcount.toLocaleString("en-IN") + " "}→</Link>
        </div>
        <div className="emp-table-wrap">
          <div style={{ overflowX: "auto" }}>
            <table className="emp-table" aria-label="Recent employee records">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Emp. Code</th>
                  <th>Department</th>
                  <th>Grade</th>
                  <th>Joined</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {employeesFailed ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "24px" }}>
                      <RefreshErrorState error={toHumanError("load", { area: "employees" })} />
                    </td>
                  </tr>
                ) : recentEmployees.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "var(--muted,#64748b)" }}>No employee records found</td></tr>
                ) : (
                  recentEmployees.map((emp, idx) => {
                    const bg = AVATAR_BG[idx % AVATAR_BG.length];
                    const fg = AVATAR_FG[idx % AVATAR_FG.length];
                    const ini = emp.name.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase();
                    return (
                      <tr key={emp.id}>
                        <td>
                          <Link href={`/hr/employees/${emp.id}`} className="emp-name-cell">
                            <span className="emp-avatar" style={{ background: bg, color: fg }}>{ini}</span>
                            <span>{emp.name}</span>
                          </Link>
                        </td>
                        <td className="emp-code">{(emp.employeeNo as string | undefined) ?? "—"}</td>
                        <td>{emp.department}</td>
                        <td>{(emp.payGrade as string | undefined) ? <span className="grade-pill">{emp.payGrade as string}</span> : "—"}</td>
                        <td className="emp-date">{formatIndianDate(emp.dateOfJoining as string | undefined)}</td>
                        {/* GAP-HR-DASHBOARD-03: shared StatusPill instead of
                            the local statusLabel() helper, which hardcoded
                            "Confirmed" for every status besides
                            probation/on_leave (suspended, deputation,
                            retired, separated, terminated all included). */}
                        <td><StatusPill status={emp.status} /></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <style>{`
        .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0; }
        .dash-body-grid { display:grid;grid-template-columns:1fr 260px 220px;gap:12px;padding:0 24px 12px; }
        .dash-col-left,.dash-col-center,.dash-col-right { min-width:0; }
        @media (max-width:900px) { .dash-body-grid { grid-template-columns:1fr;padding:0 16px 12px; } }
        .routing-failed-alert { background:var(--badbg, #fef2f2);border:1px solid var(--badbd, #fecaca);border-inline-start:4px solid var(--bad, #dc2626);border-radius:6px;padding:10px 14px;margin-bottom:12px; }
        .rf-head { font-size:12px;font-weight:700;color:var(--bad, #991b1b); }
        .rf-list { margin:6px 0 0;padding-inline-start:18px;font-size:11px;color:var(--ink,#0f172a); }
        .rf-list li { margin-bottom:2px; }
        .emp-section { margin:0 24px 32px; }
        @media (max-width:900px) { .emp-section { margin:0 16px 24px; } }
        .emp-section-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:8px; }
        .emp-section-title { font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2, #475569); }
        .emp-view-all { font-size:11px;color:var(--info, #2563eb);font-weight:600;text-decoration:none; }
        .emp-table-wrap { background:var(--panel,#fff);border-radius:8px;box-shadow:0 1px 3px rgba(15,34,64,.09); }
        .emp-table { width:100%;border-collapse:collapse;font-size:12px; }
        .emp-table th { text-align:start;padding:9px 14px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--ink2, #334155);border-bottom:1px solid var(--line,#e2e8f0);background:var(--bg,#f1f5f9);white-space:nowrap; }
        .emp-table td { padding:10px 14px;border-bottom:1px solid var(--line,#e2e8f0);vertical-align:middle; }
        .emp-table tr:last-child td { border-bottom:none; }
        .emp-name-cell { display:flex;align-items:center;gap:9px;text-decoration:none;color:inherit; }
        .emp-avatar { width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0; }
        .emp-code { color:var(--muted,#64748b);font-variant-numeric:tabular-nums; }
        .emp-date { color:var(--muted,#64748b);font-variant-numeric:tabular-nums;white-space:nowrap; }
        .grade-pill { display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:var(--bg,#f1f5f9);color:var(--ink2,#334155);border:1px solid var(--line,#e2e8f0);letter-spacing:.04em; }
      `}</style>
    </div>
  );
}
