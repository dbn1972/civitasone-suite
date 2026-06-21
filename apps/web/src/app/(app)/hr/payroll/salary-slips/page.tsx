import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getSalarySlips } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  finalized: "bg-blue-50 text-blue-700",
  paid: "bg-emerald-50 text-emerald-700",
};

function fmtAmount(minorUnits: number) {
  return `₹${(minorUnits / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function Page() {
  const { data: slips, source } = await getSalarySlips();

  const totalSlips = slips.length;
  const totalGross = slips.reduce((sum, s) => sum + s.gross, 0);
  const totalNet = slips.reduce((sum, s) => sum + s.net, 0);
  const draftCount = slips.filter((s) => s.status === "draft").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/payroll" className="hover:text-slate-900">Payroll</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Salary Slips</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Salary Slips</h1>
            <p className="mt-1 text-sm text-slate-600">Individual employee salary statements.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Slips</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{totalSlips}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Gross</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{fmtAmount(totalGross)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Net</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{fmtAmount(totalNet)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending (Draft)</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{draftCount}</p>
          </div>
        </section>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Salary slips" className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Employee ID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Department</th>
                <th className="px-4 py-3 text-left">Pay Period</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Deductions</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {slips.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No salary slips found
                  </td>
                </tr>
              ) : (
                slips.map((slip) => (
                  <tr key={slip.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{slip.employeeId}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{slip.employeeName}</td>
                    <td className="px-4 py-3 text-slate-600">{slip.department}</td>
                    <td className="px-4 py-3 text-slate-600">{slip.payPeriod}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmtAmount(slip.gross)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmtAmount(slip.deductions)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmtAmount(slip.net)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[slip.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {slip.status}
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
