import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getInfraAssets } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";

export default async function InfraAssetsPage() {
  const { data: allAssets, source } = await getInfraAssets();
  const assets = allAssets.filter((a) => a.type === "infra");
  const buildings = assets.filter((a) => a.category?.toLowerCase().includes("build")).length;
  const needsRepair = assets.filter((a) => a.condition === "poor").length;
  const netBlock = assets.reduce((sum, a) => sum + a.currentValue, 0);

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Infrastructure Assets"
        subtitle="Buildings, roads, utilities & public infrastructure register."
        actions={
          <>
            <button className="btn ghost">Map view</button>
            <button className="btn primary">+ Add Infra</button>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🏗️" iconBg="#fdf0e3" label="Infra Assets" value={assets.length.toLocaleString("en-IN")} />
        <StatCard icon="🏢" iconBg="#eff6ff" label="Buildings" value={buildings.toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Net Block" value={`₹${(netBlock / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Needs Repair" value={needsRepair.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Infrastructure asset register</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Buildings</span>
            <span>Roads</span>
            <span>Utilities</span>
          </div>
        </div>
        {assets.length === 0 ? (
          <EmptyState icon="🏗️" title="No infrastructure assets" message="Infrastructure assets will appear here once added." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>Asset</th>
                <th>Type</th>
                <th className="num">Value</th>
                <th>Condition</th>
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
                  <td>{asset.category ?? "—"}</td>
                  <td className="num">₹{(asset.currentValue / 100).toLocaleString("en-IN")}</td>
                  <td>
                    {asset.condition ? (
                      <StatusPill status={asset.condition} label={asset.condition} />
                    ) : (
                      <StatusPill status={asset.status.replace(/_/g, " ")} label={asset.status.replace(/_/g, " ")} />
                    )}
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
