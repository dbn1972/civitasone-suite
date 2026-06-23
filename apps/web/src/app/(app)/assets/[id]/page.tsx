import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetById } from "../../../_data/loaders";
import { StatusPill, EmptyState } from "../../../_components/ds";
import { AssetDetailActions } from "./AssetDetailActions";

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const { data: asset, source } = await getAssetById(params.id);

  if (!asset) {
    return (
      <>
        <a className="back" href="/assets/list">← Back</a>
        <div className="ph" style={{ marginTop: 6 }}>
          <div><h1>Asset not found</h1></div>
        </div>
        <p className="sub">The requested asset could not be found.</p>
      </>
    );
  }

  const ext = asset as typeof asset & { barcode?: string };

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <a className="back" href="/assets/list">← Back</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <div>
          <h1>
            {asset.assetCode} · {asset.name}{" "}
            <StatusPill status={asset.status.replace(/_/g, " ")} label={asset.status.replace(/_/g, " ")} />
          </h1>
        </div>
      </div>
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <AssetDetailActions assetId={asset.id} barcode={ext.barcode ?? asset.serialNo} status={asset.status} />
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Category</div><div className="v">{asset.category}</div></div>
              <div className="fld"><div className="l">Location</div><div className="v">{asset.location ?? "—"}</div></div>
              <div className="fld"><div className="l">Serial No / Barcode</div><div className="v">{asset.serialNo ?? ext.barcode ?? "—"}</div></div>
              <div className="fld"><div className="l">Acquired</div><div className="v">{asset.purchaseDate}</div></div>
              <div className="fld"><div className="l">Purchase cost</div><div className="v">₹{(asset.purchaseCost / 100).toLocaleString("en-IN")}</div></div>
              <div className="fld"><div className="l">Custodian</div><div className="v">{asset.assignedTo ?? "—"}</div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Depreciation schedule (SLM)</h3></div>
            {asset.depreciationSchedule.length === 0 ? (
              <EmptyState icon="📉" title="No depreciation schedule" message="Depreciation will appear once the asset is capitalized." />
            ) : (
              <>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="num">Opening</th>
                      <th className="num">Depreciation</th>
                      <th className="num">Net value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asset.depreciationSchedule.map((row) => (
                      <tr key={row.year}>
                        <td>FY{row.year}</td>
                        <td className="num">₹{(row.openingValue / 100).toLocaleString("en-IN")}</td>
                        <td className="num">₹{(row.depreciationAmount / 100).toLocaleString("en-IN")}</td>
                        <td className="num">₹{(row.closingValue / 100).toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pad" style={{ borderTop: "2px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
                  <b>Net book value</b>
                  <b style={{ color: "var(--primary-d)", fontSize: 17 }}>
                    ₹{(asset.currentValue / 100).toLocaleString("en-IN")}
                  </b>
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Lifecycle</h3></div>
            <div className="pad">
              <ul className="tl">
                <li className="done"><div className="t">Acquired (GRN)</div><div className="d">{asset.purchaseDate}</div></li>
                <li className={asset.status !== "condemned" && asset.status !== "disposed" ? "done" : "todo"}><div className="t">Tagged</div><div className="d"></div></li>
                <li className={asset.status === "in_use" || asset.status === "active" ? "cur" : asset.status === "disposed" || asset.status === "condemned" ? "done" : "todo"}><div className="t">In use</div><div className="d"></div></li>
                <li className={asset.warrantyExpiry ? "done" : "todo"}><div className="t">AMC</div><div className="d">{asset.warrantyExpiry ?? ""}</div></li>
                <li className={asset.status === "disposed" || asset.status === "condemned" ? "done" : "todo"}><div className="t">Disposal</div><div className="d"></div></li>
              </ul>
            </div>
          </div>
          {asset.maintenanceHistory.length > 0 ? (
            <div className="card">
              <div className="card-h"><h3>Maintenance history</h3></div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.maintenanceHistory.map((row) => (
                    <tr key={row.id}>
                      <td>{row.date}</td>
                      <td>{row.type}</td>
                      <td>{row.description}</td>
                      <td className="num">₹{(row.cost / 100).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
