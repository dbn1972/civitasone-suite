import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectFundReleases } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  sanctioned: "bg-amber-50 text-amber-700",
  released: "bg-blue-50 text-blue-700",
  utilized: "bg-emerald-50 text-emerald-700",
};

export default async function FundReleasesPage() {
  const { data: releases, source } = await getProjectFundReleases();

  const totalSanctioned = releases.filter((r) => r.status === "sanctioned").reduce((s, r) => s + r.amount, 0);
  const totalReleased = releases.filter((r) => r.status === "released").reduce((s, r) => s + r.amount, 0);
  const totalUtilized = releases.filter((r) => r.status === "utilized").reduce((s, r) => s + r.amount, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/projects" className="hover:text-slate-900">Projects</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Fund Releases</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Fund Releases</h1>
            <p className="mt-1 text-sm text-slate-600">Project fund release tracking and utilisation.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Releases</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{releases.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Sanctioned (₹)</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">₹{(totalSanctioned / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Released (₹)</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">₹{(totalReleased / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Utilized (₹)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(totalUtilized / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Fund releases" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Release No</th>
                <th className="px-4 py-3">Project Name</th>
                <th className="px-4 py-3 text-right">Amount (₹)</th>
                <th className="px-4 py-3">Release Date</th>
                <th className="px-4 py-3">Released By</th>
                <th className="px-4 py-3">Installment No</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {releases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No fund releases found</td>
                </tr>
              ) : (
                releases.map((r) => (
                  <tr key={r.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{r.releaseNo}</td>
                    <td className="px-4 py-3 text-slate-800">
                      <Link href={`/projects/${r.projectId}`} className="hover:underline text-indigo-600">{r.projectName}</Link>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-800">₹{(r.amount / 100).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-slate-600">{r.releaseDate}</td>
                    <td className="px-4 py-3 text-slate-600">{r.releasedBy ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.installmentNo ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
