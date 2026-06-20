import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getLeaveRequestDetails } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
};

export default async function Page() {
  const { data: leaveRequests, source } = await getLeaveRequestDetails();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Leave Management</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Leave Management</h1>
            <p className="mt-1 text-sm text-slate-600">Review and process employee leave requests.</p>
          </div>
          <div className="flex items-center gap-3">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <Link
              href="/hr/leave/apply"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              + New Leave
            </Link>
          </div>
        </header>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Leave Type</th>
                <th className="px-4 py-3 text-left">From Date</th>
                <th className="px-4 py-3 text-left">To Date</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3 text-left">Approver</th>
                <th className="px-4 py-3 text-left">Applied At</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {leaveRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No leave requests found
                  </td>
                </tr>
              ) : (
                leaveRequests.map((req) => (
                  <tr key={req.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{req.employeeName}</p>
                      <p className="text-xs text-slate-500 font-mono">{req.employeeId}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{req.leaveType}</td>
                    <td className="px-4 py-3 text-slate-600">{req.fromDate}</td>
                    <td className="px-4 py-3 text-slate-600">{req.toDate}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{req.days}</td>
                    <td className="px-4 py-3 text-slate-600">{req.approver ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{req.appliedAt}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[req.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {req.status}
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
