export const dynamic = "force-dynamic";
import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getHRDashboard, getEmployees, getDashboardLeaveInbox } from "../../../_data/loaders";
import { getSessionName } from "../../../../lib/auth/roleGuard";
import { GreetingHeader } from "./_components/GreetingHeader";
import { HRKPIStrip } from "./_components/HRKPIStrip";
import { ActionInbox } from "./_components/ActionInbox";
import { DeptHeadcountChart } from "./_components/DeptHeadcountChart";
import { QuickActionsPanel } from "./_components/QuickActionsPanel";
import { PayrollBanner } from "./_components/PayrollBanner";

type EmpRow = {
  id: string;
  name: string;
  department: string;
  status: string;
  employeeNo?: string;
  dateOfJoining?: string;
  payGrade?: string;
} & Record<string, unknown>;

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

function statusLabel(s: string) {
  if (s === "probation") return { label: "Probation", bg: "#fef3c7", color: "#92400e" };
  if (s === "on_leave")  return { label: "On Leave",  bg: "#dbeafe", color: "#1e40af" };
  return                        { label: "Confirmed", bg: "#d1fae5", color: "#065f46" };
}

export default async function HRDashboardPage() {
  const [dashResult, empResult, inboxResult] = await Promise.all([
    getHRDashboard(),
    getEmployees(8),
    getDashboardLeaveInbox(),
  ]);

  const { data, source } = dashResult;
  const employees = empResult.data as EmpRow[];
  const leaveInbox = inboxResult.data;

  const anyError = source === "error" || empResult.source === "error";
  const onLeaveCount = data.onLeave;
  const deptCount = data.departmentBreakdown.length > 0
    ? data.departmentBreakdown.filter((d) => !d.name.startsWith("Others")).length +
      (data.departmentBreakdown.some((d) => d.name.startsWith("Others")) ? 1 : 0)
    : 0;

  const daysLeft = payrollDaysLeft();
  const { today, dayName, monthName } = formatToday();
  const sessionName = getSessionName();
  const userName = sessionName ? sessionName.split(" ")[0] : "there";

  const recentEmployees = employees;

  return (
    <main
      className="hr-dashboard-root"
      aria-labelledby="hr-dash-heading"
      style={{ background: "var(--page-bg,#eef2f7)", minHeight: "100vh" }}
    >
      <h1 id="hr-dash-heading" className="sr-only">HR Dashboard</h1>
      {anyError && <DataSourceBadge source="error" />}

      <GreetingHeader
        userName={userName}
        pendingCount={data.pendingLeaves}
        payrollDaysLeft={daysLeft}
        today={today}
        dayName={dayName}
      />

      <HRKPIStrip
        headcount={data.headcount}
        headcountLastMonth={data.headcountLastMonth}
        pendingLeaves={data.pendingLeaves}
        onLeave={onLeaveCount}
        departments={deptCount || data.departmentBreakdown.length}
        attendanceTodayPct={data.attendanceTodayPct}
        payrollDaysLeft={daysLeft}
      />

      {/* 3-column body */}
      <div className="dash-body-grid">
        {/* Left: action inbox + payroll banner */}
        <div className="dash-col-left">
          <ActionInbox initialItems={leaveInbox} />
          <PayrollBanner daysLeft={daysLeft} monthName={monthName} headcount={data.headcount} />
        </div>

        {/* Center: dept chart */}
        <div className="dash-col-center">
          <DeptHeadcountChart breakdown={data.departmentBreakdown} />
        </div>

        {/* Right: quick actions */}
        <div className="dash-col-right">
          <QuickActionsPanel />
        </div>
      </div>

      {/* Rich employee table */}
      <section className="emp-section" aria-label="Recent employees">
        <div className="emp-section-head">
          <span className="emp-section-title">Employees</span>
          <Link href="/hr/employees" className="emp-view-all">View all {data.headcount.toLocaleString("en-IN")} →</Link>
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
                {recentEmployees.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "var(--muted,#64748b)" }}>No employee records found</td></tr>
                ) : (
                  recentEmployees.map((emp, idx) => {
                    const s = statusLabel(emp.status);
                    const bg = ["#dbeafe","#fce7f3","#d1fae5","#fef3c7","#e0e7ff","#fee2e2"][idx % 6];
                    const fg = ["#1e40af","#9d174d","#065f46","#92400e","#3730a3","#991b1b"][idx % 6];
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
                        <td className="emp-date">{(emp.dateOfJoining as string | undefined) ?? "—"}</td>
                        <td><span className="status-pill" style={{ background: s.bg, color: s.color }}><span className="status-dot" style={{ background: s.color }} />{s.label}</span></td>
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
        .emp-section { margin:0 24px 32px; }
        @media (max-width:900px) { .emp-section { margin:0 16px 24px; } }
        .emp-section-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:8px; }
        .emp-section-title { font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569; }
        .emp-view-all { font-size:11px;color:#2563eb;font-weight:600;text-decoration:none; }
        .emp-table-wrap { background:var(--surface,#fff);border-radius:8px;box-shadow:0 1px 3px rgba(15,34,64,.09); }
        .emp-table { width:100%;border-collapse:collapse;font-size:12px; }
        .emp-table th { text-align:left;padding:9px 14px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#334155;border-bottom:1px solid var(--border,#e2e8f0);background:var(--slate-100,#f1f5f9);white-space:nowrap; }
        .emp-table td { padding:10px 14px;border-bottom:1px solid var(--border,#e2e8f0);vertical-align:middle; }
        .emp-table tr:last-child td { border-bottom:none; }
        .emp-name-cell { display:flex;align-items:center;gap:9px;text-decoration:none;color:inherit; }
        .emp-avatar { width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0; }
        .emp-code { color:var(--muted,#64748b);font-variant-numeric:tabular-nums; }
        .emp-date { color:var(--muted,#64748b);font-variant-numeric:tabular-nums;white-space:nowrap; }
        .grade-pill { display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:var(--slate-100,#f1f5f9);color:var(--slate-700,#334155);border:1px solid var(--slate-200,#e2e8f0);letter-spacing:.04em; }
        .status-pill { display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600; }
        .status-dot { width:6px;height:6px;border-radius:50%;flex-shrink:0; }
      `}</style>
    </main>
  );
}
