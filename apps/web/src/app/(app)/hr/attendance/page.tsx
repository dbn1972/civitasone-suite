import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAttendanceList } from "../../../_data/loaders";

type SearchParams = { [key: string]: string | string[] | undefined };

const statusColors: Record<string, string> = {
  present: "bg-emerald-50 text-emerald-700",
  absent: "bg-red-50 text-red-700",
  half_day: "bg-yellow-50 text-yellow-700",
  on_leave: "bg-blue-50 text-blue-700",
  holiday: "bg-slate-100 text-slate-600",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const { data: attendance, source } = await getAttendanceList();
  const dateFilter = typeof searchParams.date === "string" ? searchParams.date : "";
  const statusFilter = typeof searchParams.status === "string" ? searchParams.status : "";

  const filtered = attendance.filter((row) => {
    if (dateFilter && row.date !== dateFilter) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    return true;
  });

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Attendance</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Attendance</h1>
            <p className="mt-1 text-sm text-slate-600">Daily presence and punctuality records.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <form method="GET" className="flex flex-wrap gap-3">
          <input
            type="date"
            name="date"
            defaultValue={dateFilter}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
          />
          <select
            name="status"
            defaultValue={statusFilter}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">All Statuses</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="half_day">Half Day</option>
            <option value="on_leave">On Leave</option>
            <option value="holiday">Holiday</option>
          </select>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Filter
          </button>
          <Link
            href="/hr/attendance"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Reset
          </Link>
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Attendance records" className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Employee ID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Department</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Check In</th>
                <th className="px-4 py-3 text-left">Check Out</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No attendance records found
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.employeeId}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.employeeName}</td>
                    <td className="px-4 py-3 text-slate-600">{row.department}</td>
                    <td className="px-4 py-3 text-slate-600">{row.date}</td>
                    <td className="px-4 py-3 text-slate-600">{row.checkIn ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{row.checkOut ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {row.hoursWorked != null ? row.hoursWorked.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[row.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {row.status.replace("_", " ")}
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
