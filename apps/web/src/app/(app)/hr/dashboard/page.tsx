import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getHRDashboard } from "../../../_data/loaders";

export default async function HRDashboardPage() {
  const { data, source } = await getHRDashboard();

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
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Headcount</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{data.headcount.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Attendance Today</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{data.attendanceTodayPct.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending Leaves</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{data.pendingLeaves}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Payroll Due</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">₹{(data.payrollDue / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

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
