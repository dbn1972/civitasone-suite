import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetDashboard } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";

export default async function AssetDashboardPage() {
  const { data, source } = await getAssetDashboard();
  const taggedPct = data.totalAssets > 0 ? Math.round((data.taggedAssets ?? 0) / data.totalAssets * 100) : 0;

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Asset Management"
        subtitle="Fixed assets, GRN capitalization, depreciation GL, physical verification."
        actions={
          <>
            <Link href="/assets/depreciation" className="btn ghost">Run depreciation</Link>
            <Link href="/assets/register" className="btn primary">+ Register Asset</Link>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🖥️" iconBg="#fdf0e3" label="Total Assets" value={data.totalAssets.toLocaleString("en-IN")} />
        <StatCard icon="🏗️" iconBg="#eff6ff" label="Fixed Assets" value={(data.fixedAssets ?? 0).toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Net Book Value" value={`₹${(data.netBlock / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="🏷️" iconBg="#f5f3ff" label="Tagged" value={`${taggedPct}%`} />
        <StatCard icon="🛠️" iconBg="#fffaeb" label="Under Maintenance" value={data.underMaintenance.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" iconBg="#fef2f2" label="Due Disposal" value={data.dueForDisposal.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Recent additions (from GRN)</h3>
              <Link className="lnk" href="/assets/list">Register →</Link>
            </div>
            {(data.recentGrnAssets ?? []).length === 0 ? (
              <EmptyState icon="🖥️" title="No GRN-capitalized assets" message="Accept a GRN with fixed_asset PO lines to auto-register." />
            ) : (
              <table className="tbl">
                <thead><tr><th>Code</th><th>Name</th><th>Date</th><th className="num">Cost</th></tr></thead>
                <tbody>
                  {(data.recentGrnAssets ?? []).map((a) => (
                    <tr key={a.id}>
                      <td><Link href={`/assets/${a.id}`} className="mono">{a.code}</Link></td>
                      <td>{a.name}</td>
                      <td>{a.acquisitionDate?.slice(0, 10) ?? "—"}</td>
                      <td className="num">₹{(a.acquisitionCost / 100).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Quick links</h3></div>
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <Link href="/assets/register">+ Register asset manually</Link>
              <Link href="/assets/depreciation">📉 Run monthly depreciation</Link>
              <Link href="/assets/verification">🔍 Physical verification</Link>
              <Link href="/assets/maintenance">🛠️ Maintenance queue</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
