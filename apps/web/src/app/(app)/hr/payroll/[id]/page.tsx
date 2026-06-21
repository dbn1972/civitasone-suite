import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getPayrollRunById } from "../../../../_data/loaders";

const runStatusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  processing: "bg-yellow-50 text-yellow-700",
  completed: "bg-blue-50 text-blue-700",
  paid: "bg-emerald-50 text-emerald-700",
};

const slipStatusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  finalized: "bg-blue-50 text-blue-700",
  paid: "bg-emerald-50 text-emerald-700",
};

function fmtAmount(minorUnits: number) {
  return `₹${(minorUnits / 100).toLocaleString("en-IN")}`;
}

export default async function PayrollRunDetailPage({ params }: { params: { id: string } }) {
  const { data: run, source } = await getPayrollRunById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/payroll" className="hover:text-slate-900">Payroll</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{run?.payPeriod ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Payroll Run Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {run ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Pay Period</p>
                  <p className="mt-1 font-semibold text-slate-900">{run.payPeriod}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Run Date</p>
                  <p className="mt-1 text-slate-800">{run.runDate}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Status</p>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-medium ${runStatusColors[run.status] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {run.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Employees</p>
                  <p className="mt-1 font-semibold text-slate-900">{run.employeeCount.toLocaleString("en-IN")}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Gross Amount</p>
                  <p className="mt-1 font-semibold text-slate-900">{fmtAmount(run.grossAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Deductions</p>
                  <p className="mt-1 font-semibold text-red-600">{fmtAmount(run.deductions)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Net Amount</p>
                  <p className="mt-1 font-semibold text-emerald-600">{fmtAmount(run.netAmount)}</p>
                </div>
              </div>
            </section>

            {run.salarySlips.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
                  Salary Slips ({run.salarySlips.length})
                </div>
                <table aria-label="Salary slips for this run" className="min-w-full text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left">Employee ID</th>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-right">Gross</th>
                      <th className="px-4 py-3 text-right">Deductions</th>
                      <th className="px-4 py-3 text-right">Net</th>
                      <th className="px-4 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.salarySlips.map((slip) => (
                      <tr key={slip.id} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{slip.employeeId}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{slip.employeeName}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{fmtAmount(slip.gross)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{fmtAmount(slip.deductions)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmtAmount(slip.net)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-medium ${slipStatusColors[slip.status] ?? "bg-slate-100 text-slate-600"}`}
                          >
                            {slip.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {run.salarySlips.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-slate-400 shadow-sm">
                No salary slips generated for this run yet
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Payroll run not found
          </div>
        )}
      </section>
    </main>
  );
}
