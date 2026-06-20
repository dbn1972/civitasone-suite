import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEmployees } from "../../../_data/loaders";

type SearchParams = { [key: string]: string | string[] | undefined };

const statusColors: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-700",
  active: "bg-emerald-50 text-emerald-700",
  Inactive: "bg-slate-100 text-slate-600",
  inactive: "bg-slate-100 text-slate-600",
  on_leave: "bg-blue-50 text-blue-700",
  On_Leave: "bg-blue-50 text-blue-700",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { data: employees, source } = await getEmployees();
  const dept = typeof searchParams.dept === "string" ? searchParams.dept : "";
  const status = typeof searchParams.status === "string" ? searchParams.status : "";

  const departments = [...new Set(employees.map((e) => e.department))].sort();

  const filtered = employees.filter((e) => {
    if (dept && e.department !== dept) return false;
    if (status && e.status.toLowerCase() !== status.toLowerCase()) return false;
    return true;
  });

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Employees</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Employees</h1>
            <p className="mt-1 text-sm text-slate-600">Directory of current workforce records.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <form method="GET" className="flex flex-wrap gap-3">
          <select
            name="dept"
            defaultValue={dept}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={status}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="on_leave">On Leave</option>
          </select>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Filter
          </button>
          <Link
            href="/hr/employees"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Reset
          </Link>
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Employee ID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Department</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    No employees found
                  </td>
                </tr>
              ) : (
                filtered.map((emp) => (
                  <tr key={emp.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{emp.id}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/hr/employees/${emp.id}`}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        {emp.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{emp.department}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[emp.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {emp.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
