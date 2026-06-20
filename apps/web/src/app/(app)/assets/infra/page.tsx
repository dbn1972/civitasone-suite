import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getInfraAssets } from "../../../_data/loaders";
import type { AssetSummary } from "@civitasone/types";

const statusColors: Record<AssetSummary["status"], string> = {
  active: "bg-emerald-50 text-emerald-700",
  in_use: "bg-blue-50 text-blue-700",
  maintenance: "bg-amber-50 text-amber-700",
  disposed: "bg-slate-100 text-slate-500",
  condemned: "bg-red-50 text-red-700",
};

const conditionColors: Record<NonNullable<AssetSummary["condition"]>, string> = {
  excellent: "bg-emerald-50 text-emerald-700",
  good: "bg-blue-50 text-blue-700",
  fair: "bg-amber-50 text-amber-700",
  poor: "bg-red-50 text-red-700",
};

export default async function InfraAssetsPage() {
  const { data: allAssets, source } = await getInfraAssets();
  const assets = allAssets.filter((a) => a.type === "infra");

  const netBlock = assets.reduce((sum, a) => sum + a.currentValue, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/assets" className="hover:text-slate-900">Assets</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Infrastructure Assets</span>
        </nav>

        <p className="text-xs text-slate-500">Showing assets of type: <span className="font-mono font-medium">infra</span></p>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Infrastructure Assets</h1>
            <p className="mt-1 text-sm text-slate-600">Roads, buildings, networks and other infrastructure assets.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Infra Assets</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{assets.length.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active / In Use</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">
              {assets.filter((a) => a.status === "active" || a.status === "in_use").length.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Under Maintenance</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {assets.filter((a) => a.status === "maintenance").length.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Net Block (₹)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{(netBlock / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Asset Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Purchase Date</th>
                  <th className="px-4 py-3 text-right">Purchase Cost (₹)</th>
                  <th className="px-4 py-3 text-right">Current Value (₹)</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Dept</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Condition</th>
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-slate-400">No infrastructure assets found</td>
                  </tr>
                ) : (
                  assets.map((asset) => (
                    <tr key={asset.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/assets/${asset.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                          {asset.assetCode}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{asset.name}</td>
                      <td className="px-4 py-3 text-slate-600">{asset.category}</td>
                      <td className="px-4 py-3 text-slate-600">{asset.purchaseDate}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(asset.purchaseCost / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(asset.currentValue / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-slate-600">{asset.location ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{asset.department ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[asset.status]}`}>
                          {asset.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {asset.condition ? (
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${conditionColors[asset.condition]}`}>
                            {asset.condition}
                          </span>
                        ) : "—"}
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
