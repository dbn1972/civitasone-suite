import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetDashboard } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable, RefreshErrorState } from "../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

export default async function AssetDashboardPage() {
  const { data, source } = await getAssetDashboard();
  // GAP-ASSETS-DASHBOARD-01: on a failed fetch the loader hands back the
  // all-zero ASSET_DASHBOARD_EMPTY fallback. Those zeros are not real counts,
  // so every tile gets null (StatCard renders "—") instead of 0 / ₹0.00 / 0%.
  const failed = source === "error";
  const count = (n: number | undefined) => (failed ? null : (n ?? 0).toLocaleString("en-IN"));
  const taggedPct = failed
    ? null
    : data.totalAssets > 0 ? Math.round((data.taggedAssets ?? 0) / data.totalAssets * 100) : 0;

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
      {/* GAP-ASSETS-DASHBOARD-02: each count drills into the screen that lists
          those assets. GAP-ASSETS-DASHBOARD-04: tone tokens, not hard-coded hex.
          GAP-ASSETS-DASHBOARD-05: hints state how asset-service computes each
          figure (dashboard/queries.ts). */}
      <StatGrid>
        <StatCard icon="🖥️" tone="warn" label="Total Assets" value={count(data.totalAssets)} href="/assets/list" hint="Every asset in the register, including disposed and written-off." />
        <StatCard icon="🏗️" tone="info" label="Fixed Assets" value={count(data.fixedAssets)} href="/assets/fixed-assets" hint="Assets of type Fixed." />
        <StatCard icon="🏢" tone="neutral" label="Infrastructure" value={count(data.infraAssets)} href="/assets/infra" hint="Assets of type Infrastructure." />
        <StatCard icon="💰" tone="good" label="Net Book Value" value={failed ? null : formatMoney(data.netBlock)} hint="Book value of every asset not yet disposed or written off (condemned assets stay until sold)." />
        <StatCard icon="🏷️" tone="info" label="Tagged" value={taggedPct === null ? null : `${taggedPct}%`} hint="Share of all assets that carry a barcode / QR tag." />
        <StatCard icon="🛠️" tone="warn" label="Under Maintenance" value={count(data.underMaintenance)} href="/assets/maintenance" hint="Assets whose status is Under maintenance." />
        <StatCard icon="⚠️" tone="bad" label="Due Disposal" value={count(data.dueForDisposal)} href="/assets/condemnation" hint="Active assets fully depreciated to salvage value, plus condemned assets awaiting auction." />
      </StatGrid>
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Recent additions (from GRN)</h3>
              <Link className="lnk" href="/assets/list">Register →</Link>
            </div>
            {source === "error" ? (
              <RefreshErrorState error={toHumanError("load", { area: "recent asset additions" })} />
            ) : recent.length === 0 ? (
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
                identifyingColumnKey="name"
              />
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Quick links</h3></div>
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <Link href="/assets/register">+ Register asset manually</Link>
              <Link href="/assets/depreciation"><span aria-hidden="true">📉</span> Run monthly depreciation</Link>
              <Link href="/assets/verification"><span aria-hidden="true">🔍</span> Physical verification</Link>
              <Link href="/assets/maintenance"><span aria-hidden="true">🛠️</span> Maintenance queue</Link>
              <Link href="/assets/condemnation"><span aria-hidden="true">⚠️</span> Condemnation &amp; auction</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
