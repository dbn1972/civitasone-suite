import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetDashboard } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable } from "../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

export default async function AssetDashboardPage() {
  const { data, source } = await getAssetDashboard();
  const taggedPct = data.totalAssets > 0 ? Math.round((data.taggedAssets ?? 0) / data.totalAssets * 100) : 0;

  const recent = (data.recentGrnAssets ?? []).map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    date: formatIndianDate(a.acquisitionDate),
    acquisitionCost: a.acquisitionCost,
  }));

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
        <StatCard icon="💰" iconBg="#ecfdf3" label="Net Book Value" value={formatMoney(data.netBlock)} />
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
            {recent.length === 0 ? (
              <EmptyState icon="🖥️" title="No GRN-capitalized assets" message="Accept a GRN with fixed_asset PO lines to auto-register." />
            ) : (
              <DataTable
                columns={[
                  { key: "code", label: "Code" },
                  { key: "name", label: "Name" },
                  { key: "date", label: "Date" },
                  { key: "acquisitionCost", label: "Cost", align: "right", cellType: "amount" },
                ]}
                rows={recent}
                rowLinkKey="id"
                rowLinkPrefix="/assets/"
              />
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
