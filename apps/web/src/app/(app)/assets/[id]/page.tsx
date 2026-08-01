import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetById } from "../../../_data/loaders";
import { PageHeader, StatusPill, EmptyState, DataTable } from "../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { AssetDetailActions } from "./AssetDetailActions";
import { AssetFinancialActions } from "./AssetFinancialActions";
import { RaiseEOfficeNote } from "../../../_components/RaiseEOfficeNote";

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const { data: asset, source } = await getAssetById(params.id);

  if (!asset) {
    return (
      <>
        <PageHeader title="Asset not found" back="/assets/list" backLabel="Asset Register" />
        {source === "error" ? (
          <DataSourceBadge source="error" />
        ) : (
          <EmptyState
            icon="🔍"
            title="Asset not found"
            message="The requested asset could not be found. It may have been disposed or the link is incorrect."
          />
        )}
      </>
    );
  }

  const ext = asset as typeof asset & { barcode?: string };

  const schedule = asset.depreciationSchedule.map((row) => ({
    period: `FY${row.year}`,
    openingValue: row.openingValue,
    depreciationAmount: row.depreciationAmount,
    closingValue: row.closingValue,
  }));

  const history = asset.maintenanceHistory.map((row) => ({
    id: row.id,
    date: formatIndianDate(row.date),
    type: row.type,
    description: row.description,
    cost: row.cost,
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title={`${asset.assetCode} · ${asset.name}`}
        back="/assets/list"
        backLabel="Asset Register"
        actions={<StatusPill status={asset.status.replace(/_/g, " ")} label={asset.status.replace(/_/g, " ")} />}
      />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <AssetDetailActions assetId={asset.id} barcode={ext.barcode ?? asset.serialNo} status={asset.status} />
          {asset.status !== "disposed" && asset.status !== "condemned" ? (
            <AssetFinancialActions assetId={asset.id} assetCode={asset.assetCode} bookValueMinor={asset.currentValue} />
          ) : null}
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Category</div><div className="v">{asset.category}</div></div>
              <div className="fld"><div className="l">Location</div><div className="v">{asset.location ?? "—"}</div></div>
              <div className="fld"><div className="l">Serial No / Barcode</div><div className="v">{asset.serialNo ?? ext.barcode ?? "—"}</div></div>
              <div className="fld"><div className="l">Acquired</div><div className="v">{formatIndianDate(asset.purchaseDate)}</div></div>
              <div className="fld"><div className="l">Purchase cost</div><div className="v">{formatMoney(asset.purchaseCost)}</div></div>
              <div className="fld"><div className="l">Custodian</div><div className="v">{asset.assignedTo ?? "—"}</div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Depreciation schedule (SLM)</h3></div>
            {schedule.length === 0 ? (
              <EmptyState icon="📉" title="No depreciation schedule" message="Depreciation will appear once the asset is capitalized." />
            ) : (
              <>
                <DataTable
                  columns={[
                    { key: "period", label: "Period" },
                    { key: "openingValue", label: "Opening", align: "right", cellType: "amount" },
                    { key: "depreciationAmount", label: "Depreciation", align: "right", cellType: "amount" },
                    { key: "closingValue", label: "Net value", align: "right", cellType: "amount" },
                  ]}
                  rows={schedule}
                />
                <div className="pad" style={{ borderTop: "2px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
                  <b>Net book value</b>
                  <b style={{ color: "var(--primary-d)", fontSize: 17 }}>{formatMoney(asset.currentValue)}</b>
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
                <li className="done"><div className="t">Acquired (GRN)</div><div className="d">{formatIndianDate(asset.purchaseDate)}</div></li>
                <li className={asset.status !== "condemned" && asset.status !== "disposed" ? "done" : "todo"}><div className="t">Tagged</div><div className="d"></div></li>
                <li className={asset.status === "in_use" || asset.status === "active" ? "cur" : asset.status === "disposed" || asset.status === "condemned" ? "done" : "todo"}><div className="t">In use</div><div className="d"></div></li>
                <li className={asset.warrantyExpiry ? "done" : "todo"}><div className="t">AMC</div><div className="d">{asset.warrantyExpiry ? formatIndianDate(asset.warrantyExpiry) : ""}</div></li>
                <li className={asset.status === "disposed" || asset.status === "condemned" ? "done" : "todo"}><div className="t">Disposal</div><div className="d"></div></li>
              </ul>
            </div>
          </div>
          {history.length > 0 ? (
            <div className="card">
              <div className="card-h"><h3>Maintenance history</h3></div>
              <DataTable
                columns={[
                  { key: "date", label: "Date" },
                  { key: "type", label: "Type" },
                  { key: "description", label: "Description" },
                  { key: "cost", label: "Cost", align: "right", cellType: "amount" },
                ]}
                rows={history}
              />
            </div>
          ) : null}
        </div>
      </div>

      <RaiseEOfficeNote
        refType="asset_disposal"
        refId={asset.id}
        subject={`Disposal — ${asset.assetCode} · ${asset.name}`}
        dept={asset.department ?? "Assets"}
        amountMinor={asset.currentValue}
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/assets/disposals/${asset.id}/submit-approval`}
      />
    </>
  );
}
