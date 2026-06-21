import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getPayrollRunDetails } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  processing: "bg-yellow-50 text-yellow-700",
  completed: "bg-blue-50 text-blue-700",
  paid: "bg-emerald-50 text-emerald-700",
};

function fmtAmount(minorUnits: number) {
  return `₹${(minorUnits / 100).toLocaleString("en-IN")}`;
}

export default async function Page() {
  const { data: runs, source } = await getPayrollRunDetails();

  const totalRuns = runs.length;
  const totalEmployeesPaid = runs.filter((r) => r.status === "paid").reduce((sum, r) => sum + r.employeeCount, 0);
  const totalNetDisbursed = runs.filter((r) => r.status === "paid").reduce((sum, r) => sum + r.netAmount, 0);
  const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Payroll</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Payroll Runs</h1>
            <p className="mt-1 text-sm text-slate-600">Monthly salary processing and statutory run status.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Runs</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{totalRuns}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Employees Paid</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{totalEmployeesPaid.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Net Disbursed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{fmtAmount(totalNetDisbursed)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Last Run</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{lastRun?.runDate ?? "—"}</p>
          </div>
        </section>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Payroll runs" className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Pay Period</th>
                <th className="px-4 py-3 text-left">Run Date</th>
                <th className="px-4 py-3 text-right">Employees</th>
                <th className="px-4 py-3 text-right">Gross Amount</th>
                <th className="px-4 py-3 text-right">Deductions</th>
                <th className="px-4 py-3 text-right">Net Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No payroll runs found
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/hr/payroll/${run.id}`}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        {run.payPeriod}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{run.runDate}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{run.employeeCount.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmtAmount(run.grossAmount)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmtAmount(run.deductions)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{fmtAmount(run.netAmount)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[run.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {run.status}
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
