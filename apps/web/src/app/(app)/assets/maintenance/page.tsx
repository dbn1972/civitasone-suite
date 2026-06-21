import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetMaintenance } from "../../../_data/loaders";
import type { MaintenanceSummary } from "@civitasone/types";

const maintenanceTypeColors: Record<MaintenanceSummary["maintenanceType"], string> = {
  preventive: "bg-blue-50 text-blue-700",
  corrective: "bg-orange-50 text-orange-700",
  amc: "bg-emerald-50 text-emerald-700",
  breakdown: "bg-red-50 text-red-700",
};

const statusColors: Record<MaintenanceSummary["status"], string> = {
  scheduled: "bg-blue-50 text-blue-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
  overdue: "bg-red-50 text-red-700",
};

export default async function AssetMaintenancePage() {
  const { data: records, source } = await getAssetMaintenance();

  const scheduled = records.filter((r) => r.status === "scheduled").length;
  const overdue = records.filter((r) => r.status === "overdue").length;
  const completed = records.filter((r) => r.status === "completed").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/assets" className="hover:text-slate-900">Assets</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Maintenance</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Asset Maintenance</h1>
            <p className="mt-1 text-sm text-slate-600">Preventive, corrective, AMC and breakdown maintenance records.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Records</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{records.length.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Scheduled</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{scheduled.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{overdue.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{completed.toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table aria-label="Maintenance records" className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">Asset Code</th>
                  <th scope="col" className="px-4 py-3">Asset Name</th>
                  <th scope="col" className="px-4 py-3">Maintenance Type</th>
                  <th scope="col" className="px-4 py-3">Scheduled Date</th>
                  <th scope="col" className="px-4 py-3">Completed Date</th>
                  <th scope="col" className="px-4 py-3">Vendor</th>
                  <th scope="col" className="px-4 py-3 text-right">Est. Cost (₹)</th>
                  <th scope="col" className="px-4 py-3 text-right">Actual Cost (₹)</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-slate-400">No maintenance records found</td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/assets/${r.assetId}`} className="font-mono text-xs text-blue-600 hover:underline">
                          {r.assetCode}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{r.assetName}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${maintenanceTypeColors[r.maintenanceType]}`}>
                          {r.maintenanceType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.scheduledDate}</td>
                      <td className="px-4 py-3 text-slate-600">{r.completedDate ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{r.vendor ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(r.estimatedCost / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(r.actualCost / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[r.status]}`}>
                          {r.status.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
