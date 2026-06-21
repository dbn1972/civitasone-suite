import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAppraisals } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  in_review: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
};

const statusLabel: Record<string, string> = {
  pending: "Not started",
  in_review: "Manager review",
  completed: "Finalised",
};

export default async function Page() {
  const { data: appraisals, source } = await getAppraisals();

  const total = appraisals.length;
  const reviewsDone = appraisals.filter((a) => a.status === "completed").length;
  const inReview = appraisals.filter((a) => a.status === "in_review").length;
  const pending = appraisals.filter((a) => a.status === "pending").length;
  const rated = appraisals.filter((a) => a.rating != null);
  const avgRating = rated.length > 0
    ? rated.reduce((sum, a) => sum + (a.rating ?? 0), 0) / rated.length
    : null;
  const cyclePct = total > 0 ? Math.round((reviewsDone / total) * 100) : 0;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Appraisals</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Appraisals</h1>
            <p className="mt-1 text-sm text-slate-600">Employee performance review cycle.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Cycle Progress</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{cyclePct}%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Reviews Done</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">
              {reviewsDone}
              <span className="text-base font-normal text-slate-400">/{total}</span>
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Avg Rating</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {avgRating != null ? avgRating.toFixed(1) : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-yellow-600">{pending}</p>
          </div>
        </section>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Appraisals" className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Manager / Reviewer</th>
                <th className="px-4 py-3 text-right">Rating</th>
                <th className="px-4 py-3 text-left">Period</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {appraisals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No appraisals found
                  </td>
                </tr>
              ) : (
                appraisals.map((appraisal) => (
                  <tr key={appraisal.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{appraisal.employeeName}</p>
                      <p className="text-xs text-slate-500">{appraisal.department}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{appraisal.reviewerName ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {appraisal.rating != null ? (
                        <span className="font-semibold text-slate-900">{appraisal.rating.toFixed(1)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{appraisal.appraisalPeriod}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[appraisal.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {statusLabel[appraisal.status] ?? appraisal.status}
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
