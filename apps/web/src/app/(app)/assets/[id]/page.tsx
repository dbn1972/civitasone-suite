import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetById } from "../../../_data/loaders";
import type { AssetDetail } from "@civitasone/types";

const statusColors: Record<NonNullable<AssetDetail["status"]>, string> = {
  active: "bg-emerald-50 text-emerald-700",
  in_use: "bg-blue-50 text-blue-700",
  maintenance: "bg-amber-50 text-amber-700",
  disposed: "bg-slate-100 text-slate-500",
  condemned: "bg-red-50 text-red-700",
};

const conditionColors: Record<NonNullable<AssetDetail["condition"]>, string> = {
  excellent: "bg-emerald-50 text-emerald-700",
  good: "bg-blue-50 text-blue-700",
  fair: "bg-amber-50 text-amber-700",
  poor: "bg-red-50 text-red-700",
};

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const { data: asset, source } = await getAssetById(params.id);

  if (!asset) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-7xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/assets" className="hover:text-slate-900">Assets</Link>
            <span className="mx-2">/</span>
            <Link href="/assets/list" className="hover:text-slate-900">Asset Register</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="text-slate-500">Asset not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/assets" className="hover:text-slate-900">Assets</Link>
          <span className="mx-2">/</span>
          <Link href="/assets/list" className="hover:text-slate-900">Asset Register</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{asset.assetCode}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold text-slate-900">{asset.name}</h1>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[asset.status]}`}>
                {asset.status.replace("_", " ")}
              </span>
              {asset.condition ? (
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${conditionColors[asset.condition]}`}>
                  {asset.condition}
                </span>
              ) : null}
            </div>
            <p className="mt-1 font-mono text-sm text-slate-600">{asset.assetCode} · {asset.category} · {asset.type}</p>
            {asset.description ? <p className="mt-2 text-sm text-slate-600">{asset.description}</p> : null}
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Details</h2>
          </div>
          <dl className="grid grid-cols-2 gap-4 p-6 md:grid-cols-3 lg:grid-cols-4">
            {[
              { label: "Purchase Date", value: asset.purchaseDate },
              { label: "Purchase Cost (₹)", value: `₹${(asset.purchaseCost / 100).toLocaleString("en-IN")}` },
              { label: "Current Value (₹)", value: `₹${(asset.currentValue / 100).toLocaleString("en-IN")}` },
              { label: "Serial No", value: asset.serialNo ?? "—" },
              { label: "Warranty Expiry", value: asset.warrantyExpiry ?? "—" },
              { label: "Location", value: asset.location ?? "—" },
              { label: "Assigned To", value: asset.assignedTo ?? "—" },
              { label: "Department", value: asset.department ?? "—" },
            ].map((field) => (
              <div key={field.label}>
                <dt className="text-xs text-slate-500">{field.label}</dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Depreciation Schedule</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Year</th>
                  <th className="px-4 py-3 text-right">Opening Value (₹)</th>
                  <th className="px-4 py-3 text-right">Depreciation (₹)</th>
                  <th className="px-4 py-3 text-right">Rate %</th>
                  <th className="px-4 py-3 text-right">Closing Value (₹)</th>
                </tr>
              </thead>
              <tbody>
                {asset.depreciationSchedule.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">No depreciation schedule</td>
                  </tr>
                ) : (
                  asset.depreciationSchedule.map((row) => (
                    <tr key={row.year} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">FY{row.year}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(row.openingValue / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-red-600">₹{(row.depreciationAmount / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{row.rate}%</td>
                      <td className="px-4 py-3 text-right text-emerald-700">₹{(row.closingValue / 100).toLocaleString("en-IN")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Maintenance History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Cost (₹)</th>
                  <th className="px-4 py-3">Vendor</th>
                </tr>
              </thead>
              <tbody>
                {asset.maintenanceHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">No maintenance history</td>
                  </tr>
                ) : (
                  asset.maintenanceHistory.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600">{row.date}</td>
                      <td className="px-4 py-3 text-slate-700">{row.type}</td>
                      <td className="px-4 py-3 text-slate-700">{row.description}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(row.cost / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-slate-600">{row.vendor ?? "—"}</td>
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
