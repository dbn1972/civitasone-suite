import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssetById, getAssetLocations } from "../../../_data/loaders";
import { PageHeader, EmptyState, DataTable, RefreshErrorState, RecordHeader, DetailList } from "../../../_components/ds";
import { assetLocationIdToResolve, assetLocationLabel } from "./assetLocation";
import { assetCanRaiseDisposal, assetIsFinished, assetRaiseBlockedReason } from "@/lib/records/status/asset";
import { outcomeLine } from "@/lib/records/statusActions";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { AssetDetailActions } from "./AssetDetailActions";
import { AssetFinancialActions } from "./AssetFinancialActions";
import { RaiseEOfficeNote } from "../../../_components/RaiseEOfficeNote";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWriteAssets } from "@/lib/auth/workRoles";
import { assetActionScope, deriveLifecycle } from "@/lib/assetLifecycle";
import { getTranslations } from "next-intl/server";
import { AccountingBanner } from "../AccountingBanner";
import { journalKey, journalState, journalTone, rejectionNote } from "../glStatus";

export default async function AssetDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  const tGl = await getTranslations("assetsGl");
  // UX-R5 (names, not ids): resolve a location id (a transfer stores the destination id in `location`) against
  // the tenant functional-location register -- only when the asset does not already carry a readable name.
  const locationIdToResolve = assetLocationIdToResolve(asset);
  const locationNames = new Map<string, string>();
  if (locationIdToResolve) {
    const locs = await getAssetLocations();
    for (const l of locs.data) locationNames.set(l.id, l.name);
  }
  const location = assetLocationLabel(asset, locationNames);
  const finished = assetIsFinished(asset.status);
  const journal = journalState(asset.glPostStatus);
  const rejection = journal === "failed" ? rejectionNote(asset.glPostError) : null;

  return (
    <>
      {anyFailed && <DataSourceBadge source="error" />}
      <RecordHeader
        kind="Asset"
        recordNo={asset.assetCode}
        subtitle={asset.name}
        back="/assets/list"
        backLabel="Asset Register"
        status={asset.status}
        amountMinor={asset.currentValue}
        amountLabel="Book value"
        parties={[
          location ? { label: "Location", value: location.label } : null,
          asset.category ? { label: "Category", value: asset.category } : null,
        ]}
        outcome={finished ? outcomeLine({ status: asset.status }) : null}
      />
      {/* Impairment / revaluation need their own GL accounts; the banner shows when they are not set up. */}
      {scope === "full" ? <AccountingBanner areas={["impairment", "revaluation"]} /> : null}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <AssetDetailActions assetId={asset.id} barcode={asset.barcode} status={asset.status} roles={roles} />
          {scope === "full" ? (
            <AssetFinancialActions assetId={asset.id} assetCode={asset.assetCode} bookValueMinor={asset.currentValue} />
          ) : null}
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="pad">
              <DetailList
                ariaLabel="Asset details"
                columns={1}
                items={[
                  { label: "Category", value: asset.category },
                  {
                    label: "Location",
                    value: location ? (location.linked ? <Link href="/assets/locations">{location.label}</Link> : location.label) : null,
                  },
                  { label: "Serial No / Barcode", value: asset.serialNo ?? asset.barcode ?? null, mono: true },
                  { label: "Acquired", value: formatIndianDate(asset.purchaseDate) },
                  { label: "Purchase cost", value: formatMoney(asset.purchaseCost) },
                  { label: "Custodian", value: asset.assignedTo ?? null },
                  {
                    label: tGl("journal"),
                    value: journal === "none" ? null : (
                      <>
                        <span className={`pill ${journalTone(journal)}`}>{tGl(journalKey(journal))}</span>
                        {rejection ? <p role="alert" style={{ fontSize: 12, margin: "6px 0 0", whiteSpace: "normal" }}>{tGl(rejection.key, { reason: rejection.reason })}</p> : null}
                      </>
                    ),
                  },
                ]}
              />
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
        statusAllowsRaise={assetCanRaiseDisposal(asset.status)}
        outcome={assetRaiseBlockedReason(asset.status)}
      />
      ) : null}
    </>
  );
}
