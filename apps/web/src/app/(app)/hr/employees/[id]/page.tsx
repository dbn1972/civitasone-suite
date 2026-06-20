import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getEmployeeById } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-700",
  active: "bg-emerald-50 text-emerald-700",
  Inactive: "bg-slate-100 text-slate-600",
  inactive: "bg-slate-100 text-slate-600",
};

export default async function EmployeeDetailPage({ params }: { params: { id: string } }) {
  const { data: employee, source } = await getEmployeeById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/employees" className="hover:text-slate-900">Employees</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{employee?.name ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Employee Profile</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {employee ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Personal Information</h2>
              <div className="grid grid-cols-2 gap-5 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Employee ID</p>
                  <p className="mt-1 font-mono font-medium text-slate-900">{employee.employeeId}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Full Name</p>
                  <p className="mt-1 font-medium text-slate-900">{employee.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Status</p>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-medium ${statusColors[employee.status] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {employee.status}
                  </span>
                </div>
                {employee.email && (
                  <div>
                    <p className="text-xs text-slate-500">Email</p>
                    <p className="mt-1 text-slate-800">{employee.email}</p>
                  </div>
                )}
                {employee.phone && (
                  <div>
                    <p className="text-xs text-slate-500">Phone</p>
                    <p className="mt-1 text-slate-800">{employee.phone}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500">Joining Date</p>
                  <p className="mt-1 text-slate-800">{employee.joiningDate}</p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Designation &amp; Posting</h2>
              <div className="grid grid-cols-2 gap-5 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Department</p>
                  <p className="mt-1 text-slate-800">{employee.department}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Designation</p>
                  <p className="mt-1 text-slate-800">{employee.designation}</p>
                </div>
                {employee.grade && (
                  <div>
                    <p className="text-xs text-slate-500">Grade</p>
                    <p className="mt-1 text-slate-800">{employee.grade}</p>
                  </div>
                )}
                {employee.reportingTo && (
                  <div>
                    <p className="text-xs text-slate-500">Reporting To</p>
                    <p className="mt-1 text-slate-800">{employee.reportingTo}</p>
                  </div>
                )}
                {employee.postingLocation && (
                  <div>
                    <p className="text-xs text-slate-500">Posting Location</p>
                    <p className="mt-1 text-slate-800">{employee.postingLocation}</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Employee not found
          </div>
        )}
      </section>
    </main>
  );
}
