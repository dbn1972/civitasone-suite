import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getHRDashboard, getEmployees, getJobOpenings } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-700",
  active: "bg-emerald-50 text-emerald-700",
  on_leave: "bg-blue-50 text-blue-700",
  Inactive: "bg-slate-100 text-slate-600",
  inactive: "bg-slate-100 text-slate-600",
};

export default async function HRDashboardPage() {
  const [dashResult, empResult, jobResult] = await Promise.all([
    getHRDashboard(),
    getEmployees(),
    getJobOpenings(),
  ]);

  const { data, source } = dashResult;
  const employees = empResult.data;
  const openRoles = jobResult.data.filter((j) => j.status === "open").length;
  const onLeaveCount = employees.filter((e) => e.status === "on_leave" || e.status === "On_Leave").length;
  const anyError = source === "error" || empResult.source === "error" || jobResult.source === "error";

  const recentEmployees = employees.slice(0, 8);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">HR Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">People operations overview.</p>
          </div>
          {anyError ? <DataSourceBadge source="error" /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Headcount</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{data.headcount.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Present Today</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{data.attendanceTodayPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">On Leave</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{onLeaveCount}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Open Roles</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{openRoles}</p>
          </div>
        </section>

        {recentEmployees.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Employees</p>
              <Link href="/hr/employees" className="text-xs text-indigo-600 hover:underline">View all →</Link>
            </div>
            <table aria-label="Employee directory preview" className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left text-xs">Employee</th>
                  <th className="px-4 py-2 text-left text-xs">Department</th>
                  <th className="px-4 py-2 text-left text-xs">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentEmployees.map((emp) => (
                  <tr key={emp.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/hr/employees/${emp.id}`} className="font-medium text-indigo-600 hover:underline">
                        {emp.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{emp.department}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[emp.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {emp.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[
            { label: "Employees", href: "/hr/employees" },
            { label: "Attendance", href: "/hr/attendance" },
            { label: "Attendance Regularisation", href: "/hr/attendance/regularisation" },
            { label: "Leave Management", href: "/hr/leave" },
            { label: "Apply Leave", href: "/hr/leave/apply" },
            { label: "Payroll Runs", href: "/hr/payroll" },
            { label: "Salary Slips", href: "/hr/payroll/salary-slips" },
            { label: "Recruitment", href: "/hr/recruitment" },
            { label: "Appraisals", href: "/hr/appraisals" },
            { label: "Training Programs", href: "/hr/training" },
            { label: "Org Chart", href: "/hr/orgchart" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md text-sm font-medium text-slate-800"
            >
              {link.label}
            </Link>
          ))}
        </section>
      </section>
    </main>
  );
}
