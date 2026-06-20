import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getAttendanceRegularisations } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

export default async function Page() {
  const { data: regs, source } = await getAttendanceRegularisations();

  const total = regs.length;
  const pending = regs.filter((r) => r.status === "pending").length;
  const approved = regs.filter((r) => r.status === "approved").length;
  const rejected = regs.filter((r) => r.status === "rejected").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/attendance" className="hover:text-slate-900">Attendance</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Regularisation</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Attendance Regularisation</h1>
            <p className="mt-1 text-sm text-slate-600">Employee requests to correct attendance records.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Requests</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{pending}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Approved</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{approved}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Rejected</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{rejected}</p>
          </div>
        </section>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Requested Status</th>
                <th className="px-4 py-3 text-left">Request Date</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {regs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No regularisation requests found
                  </td>
                </tr>
              ) : (
                regs.map((reg) => (
                  <tr key={reg.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{reg.employeeName}</p>
                      <p className="text-xs text-slate-500 font-mono">{reg.employeeId}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{reg.date}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{reg.reason}</td>
                    <td className="px-4 py-3 text-slate-600">{reg.requestedStatus}</td>
                    <td className="px-4 py-3 text-slate-600">{reg.requestedAt}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[reg.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {reg.status}
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
