import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getFixedAssets } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";

export default async function FixedAssetsPage() {
  const { data: allAssets, source } = await getFixedAssets();
  const assets = allAssets.filter((a) => a.type === "fixed");
  const totalActive = assets.filter((a) => a.status === "active" || a.status === "in_use").length;
  const grossBlock = assets.reduce((sum, a) => sum + a.purchaseCost, 0);
  const netBlock = assets.reduce((sum, a) => sum + a.currentValue, 0);
  const tagged = assets.length > 0 ? Math.round((totalActive / assets.length) * 100) : 0;

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Fixed Asset Register"
        subtitle="Register, tag (QR) and value fixed assets."
        actions={
          <>
            <button className="btn ghost">Bulk tag</button>
            <button className="btn primary">+ Register Asset</button>
          </>
        }
      />
      <div
        className="banner"
        style={{
          background: "#fdf0e3",
          border: "1px solid #fcd9b6",
          color: "#9a3412",
          borderRadius: 12,
          padding: "13px 16px",
          marginBottom: 18,
          fontSize: 13,
        }}
      >
        🔗 <b>Auto-capitalised from Procurement GRN.</b> Accepted capital goods create asset records here; depreciation posts to Finance.
      </div>
      <StatGrid>
        <StatCard icon="🖥️" iconBg="#fdf0e3" label="Fixed Assets" value={assets.length.toLocaleString("en-IN")} delta="+85" up />
        <StatCard icon="🔖" iconBg="#eff6ff" label="Tagged (QR)" value={`${tagged}%`} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Gross Block" value={`₹${(grossBlock / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="📉" iconBg="#fffaeb" label="Net Book Value" value={`₹${(netBlock / 100).toLocaleString("en-IN")}`} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Fixed asset register</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Untagged</span>
            <span>AMC due</span>
          </div>
        </div>
        {assets.length === 0 ? (
          <EmptyState icon="🖥️" title="No fixed assets found" message="Fixed assets will appear here once registered." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Item</th>
                <th>Location</th>
                <th className="num">Net value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="clickable">
                  <td>
                    <a href={`/assets/${asset.id}`}>
                      <span className="mono">{asset.assetCode}</span>
                    </a>
                  </td>
                  <td>{asset.name}</td>
                  <td>{asset.location ?? "—"}</td>
                  <td className="num">₹{(asset.currentValue / 100).toLocaleString("en-IN")}</td>
                  <td>
                    <StatusPill status={asset.status.replace(/_/g, " ")} label={asset.status.replace(/_/g, " ")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
