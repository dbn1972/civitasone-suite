import { HR_STAFF_MANAGER_ROLES, HR_STAFF_ROLES, PAYROLL_READER_ROLES, PAYROLL_STAFF_ROLES } from "@/lib/auth/workRoles";
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
import { formatIndianDate, humanizeStatus, greetingForHour, currentIstHour, formatInIST } from "@/lib/formatters";
import { GreetingHeader } from "./_components/GreetingHeader";
import { HRKPIStrip } from "./_components/HRKPIStrip";
import { MyKPIStrip } from "./_components/MyKPIStrip";
import { ActionInbox } from "./_components/ActionInbox";
import { MyLeaveStatusPanel } from "./_components/MyLeaveStatusPanel";
import { DeptHeadcountChart } from "./_components/DeptHeadcountChart";
import { QuickActionsPanel } from "./_components/QuickActionsPanel";
import { PayrollBanner } from "./_components/PayrollBanner";
// Page-local colour tokens + every dashboard component's styles (GAP-HR-DASHBOARD-09).
import "./dashboard.css";

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
const HR_DASHBOARD_READER_ROLES = HR_STAFF_MANAGER_ROLES;

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
const EMPLOYEE_ADMIN_ROLES = HR_STAFF_ROLES;

// GAP-HR-DASHBOARD-05: mirrors hr/payroll/page.tsx's own PAYROLL_ADMIN_ROLES
// exactly (that page's own canAdminister flag, which hides its run-payroll
// form for anyone outside this set). Deliberately its own constant, not a
// reuse of EMPLOYEE_ADMIN_ROLES above: payroll administration and employee
// administration are different privileges in this app's role model, even
// though both happen to be held by hr_admin/super_admin today.

type EmpRow = {
  id: string;
  name: string;
  department: string;
  status: string;
  employeeNo?: string;
  dateOfJoining?: string;
  payGrade?: string;
} & Record<string, unknown>;

// GAP-HR-DASHBOARD-09: rotating avatar-tint palette. The colours live in
// dashboard.css (--dash-avatar-bg-N / --dash-avatar-fg-N, with light and dark
// values), not here. Duplicated from ActionInbox.tsx's own AVATAR_BG/FG
// rather than shared, matching this file's existing "each own copy"
// convention.
const AVATAR_BG = ["var(--dash-avatar-bg-1)", "var(--dash-avatar-bg-2)", "var(--dash-avatar-bg-3)", "var(--dash-avatar-bg-4)", "var(--dash-avatar-bg-5)", "var(--dash-avatar-bg-6)"];
const AVATAR_FG = ["var(--dash-avatar-fg-1)", "var(--dash-avatar-fg-2)", "var(--dash-avatar-fg-3)", "var(--dash-avatar-fg-4)", "var(--dash-avatar-fg-5)", "var(--dash-avatar-fg-6)"];

function payrollDaysLeft(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.getDate() - now.getDate();
}

function formatToday(): { today: string; dayName: string; monthName: string } {
  const d = new Date();
  return {
    today: formatInIST(d, { day: "numeric", month: "long", year: "numeric" }),
    dayName: formatInIST(d, { weekday: "long" }),
    monthName: formatInIST(d, { month: "long", year: "numeric" }),
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
        style={{ background: "var(--page-bg)", minHeight: "100vh" }}
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
  // check exactly (PAYROLL_STAFF_ROLES above) -- gates whether PayrollBanner
  // shows a "Start Run" link a manager would only reach a dead-end
  // PermissionDenied wall from.
  const canRunPayroll = roles.some((r) => PAYROLL_STAFF_ROLES.includes(r));
  // GAP-HR-DASHBOARD-05: can the viewer open /hr/payroll at all (it renders
  // PermissionDenied outside PAYROLL_READER_ROLES)? Gates the "Run Payroll"
  // quick action, which would otherwise lead hr_officer/manager to that wall.
  const canViewPayroll = roles.some((r) => PAYROLL_READER_ROLES.includes(r));
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
      style={{ background: "var(--page-bg)", minHeight: "100vh" }}
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
          style={{ margin: "0 24px 8px", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}
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
      <div className="dash-body-grid dash-body-grid-staff">
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
          <QuickActionsPanel variant={canManageEmployees ? "admin" : "manager"} canViewPayroll={canViewPayroll} />
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
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "var(--muted)" }}>No employee records found</td></tr>
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

    </div>
  );
}
