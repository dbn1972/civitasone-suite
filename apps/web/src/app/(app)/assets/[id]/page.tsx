import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetById } from "../../../_data/loaders";
import { PageHeader, StatusPill, EmptyState, DataTable, RefreshErrorState } from "../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { AssetDetailActions } from "./AssetDetailActions";
import { AssetFinancialActions } from "./AssetFinancialActions";
import { RaiseEOfficeNote } from "../../../_components/RaiseEOfficeNote";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWriteAssets } from "@/lib/auth/workRoles";
import { assetActionScope, deriveLifecycle } from "@/lib/assetLifecycle";

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const { data: asset, source, parts } = await getAssetById(params.id);

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

  // GAP-ASSETS-INFRA-05: roads/drains/buildings are not tagged or under an AMC;
  // those lifecycle steps are movable-asset concepts. The depreciation schedule
  // is kept for infra pending a finance decision (see PR VERIFY list).
  const isInfra = asset.type === "infra";
  const scope = assetActionScope(asset.status);
  const lifecycle = deriveLifecycle({
    status: asset.status,
    barcode: asset.barcode,
    warrantyExpiry: asset.warrantyExpiry,
    maintenanceHistory: asset.maintenanceHistory,
    purchaseDate: asset.purchaseDate,
    formatDate: formatIndianDate,
  });
  const roles = getSessionRoles();
  // GAP-ASSETS-DETAIL-01: each sub-fetch reports its own source.
  const depFailed = parts.depreciation === "error";
  const maintFailed = parts.maintenance === "error";
  const anyFailed = source === "error" || depFailed || maintFailed;

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
      {anyFailed && <DataSourceBadge source="error" />}
      <PageHeader
        title={`${asset.assetCode} · ${asset.name}`}
        back="/assets/list"
        backLabel="Asset Register"
        actions={<StatusPill status={asset.status.replace(/_/g, " ")} label={asset.status.replace(/_/g, " ")} />}
      />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <AssetDetailActions assetId={asset.id} barcode={asset.barcode} status={asset.status} roles={roles} />
          {scope === "full" ? (
            <AssetFinancialActions assetId={asset.id} assetCode={asset.assetCode} bookValueMinor={asset.currentValue} />
          ) : null}
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Category</div><div className="v">{asset.category}</div></div>
              <div className="fld"><div className="l">Location</div><div className="v">{asset.location ?? "—"}</div></div>
              <div className="fld"><div className="l">Serial No / Barcode</div><div className="v">{asset.serialNo ?? asset.barcode ?? "—"}</div></div>
              <div className="fld"><div className="l">Acquired</div><div className="v">{formatIndianDate(asset.purchaseDate)}</div></div>
              <div className="fld"><div className="l">Purchase cost</div><div className="v">{formatMoney(asset.purchaseCost)}</div></div>
              <div className="fld"><div className="l">Custodian</div><div className="v">{asset.assignedTo ?? "—"}</div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Depreciation schedule (SLM)</h3></div>
            {depFailed ? (
              <RefreshErrorState error={toHumanError("load", { area: "depreciation schedule" })} />
            ) : schedule.length === 0 ? (
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
                {lifecycle
                  .filter((step) => !(isInfra && (step.label === "Tagged" || step.label === "AMC")))
                  .map((step) => (
                    <li key={step.label} className={step.state}><div className="t">{step.label}</div><div className="d">{step.detail}</div></li>
                  ))}
              </ul>
            </div>
          </div>
          {maintFailed ? (
            <div className="card">
              <div className="card-h"><h3>Maintenance history</h3></div>
              <RefreshErrorState error={toHumanError("load", { area: "maintenance history" })} />
            </div>
          ) : history.length > 0 ? (
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

      {canWriteAssets(roles) && scope === "full" ? (
      <RaiseEOfficeNote
        refType="asset_disposal"
        refId={asset.id}
        subject={`Disposal — ${asset.assetCode} · ${asset.name}`}
        dept={asset.department ?? "Assets"}
        amountMinor={asset.currentValue}
        defaultApprovalChain="file_noting"
      />
      ) : null}
    </>
  );
}
