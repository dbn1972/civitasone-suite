import { PageHeader, Card, StatusPill, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getGoodsReturnById } from "@/app/_data/loaders";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { getInventorySettings } from "../../_data";
import { formatIndianDate } from "@/lib/formatters";
import { getItemNames, getStoreNames } from "../../_lookups";
import { itemLabel, nameOrDash, userRefLabel } from "../../_labels";
import { QcInspectionForm } from "./QcInspectionForm";
import { dispositionLabel } from "./qcMatrix";

export default async function GoodsReturnDetailPage({ params }: { params: { id: string } }) {
  const result = await getGoodsReturnById(params.id);
  const { data: goodsReturn } = result;

  // GAP-INVENTORY-GOODS-RETURNS-DETAIL-03: only a real 404 is "not found";
  // 5xx/timeout get a retry state and 403 a permission-denied state.
  if (result.source === "error" && result.status !== 404) {
    return (
      <>
        <PageHeader title="Goods Return" back="/inventory/goods-returns" />
        <LoadErrorState result={result} area="goods return" backHref="/inventory/goods-returns" />
      </>
    );
  }

  if (!goodsReturn) {
    return (
      <>
        <PageHeader title="Goods Return" back="/inventory/goods-returns" />
        <EmptyState
          icon="📦"
          title="Goods return not found"
          message="This goods return record could not be found, or you don't have access to it."
        />
      </>
    );
  }

  const isPending = goodsReturn.qcStatus === "pending";

  // GAP-INVENTORY-GOODS-RETURNS-DETAIL-04: maker != checker (per-tenant policy, default ON). The
  // service enforces it; here we just stop offering a form that is guaranteed to 403.
  const settings = isPending ? await getInventorySettings() : null;
  const makerChecker = settings ? settings.data.qcMakerChecker : true;
  const isMaker = Boolean(goodsReturn.createdBy) && goodsReturn.createdBy === getSessionUserId();
  const blockedAsMaker = isPending && makerChecker && isMaker;

  // GAP-INVENTORY-GOODS-RETURNS-02 / DETAIL-05: show names, not UUIDs. Both
  // lookups are best-effort; an unresolved item falls back to its short id and
  // an unresolved store to "—" (the full ids stay in the tooltips). The item is
  // deliberately not linked: /inventory/[id] reads the stock-service master,
  // whose ids differ from this inventory-service item id.
  const [itemNames, storeNames] = await Promise.all([getItemNames([goodsReturn.itemId]), getStoreNames()]);
  const itemRef = itemNames.get(goodsReturn.itemId);
  const itemText = itemLabel({ itemId: goodsReturn.itemId, itemName: itemRef?.name, itemSku: itemRef?.sku });

  return (
    <>
      <PageHeader
        title="Goods Return — QC Inspection"
        subtitle={`Return #${goodsReturn.id.slice(0, 8)}`}
        back="/inventory/goods-returns"
        actions={<StatusPill status={goodsReturn.qcStatus} />}
      />

      <Card title="Return details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Original stock issue</span>
            <span className="mono" title="Stock issue id; the service does not return a document number">
              {goodsReturn.originalIssueId}
            </span>
          </div>
          <div className="field">
            <span className="label">Item</span>
            <span title={goodsReturn.itemId}>{itemText}</span>
          </div>
          <div className="field">
            <span className="label">Store</span>
            <span title={goodsReturn.storeId}>{nameOrDash(storeNames.get(goodsReturn.storeId))}</span>
          </div>
          <div className="field">
            <span className="label">Quantity</span>
            <span>{goodsReturn.qty}</span>
          </div>
          <div className="field">
            <span className="label">Reason for return</span>
            <span>{goodsReturn.reason}</span>
          </div>
          <div className="field">
            <span className="label">Returned on</span>
            <span>{formatIndianDate(goodsReturn.createdAt)}</span>
          </div>
          {goodsReturn.createdBy ? (
            <div className="field">
              <span className="label">Recorded by</span>
              <span title={goodsReturn.createdBy}>{userRefLabel(goodsReturn.createdBy, goodsReturn.createdByName)}</span>
            </div>
          ) : null}
          {!isPending ? (
            <>
              <div className="field">
                <span className="label">QC verdict</span>
                <StatusPill status={goodsReturn.qcStatus} />
              </div>
              <div className="field">
                <span className="label">Disposition</span>
                <StatusPill status={goodsReturn.disposition} label={dispositionLabel(goodsReturn.disposition)} />
              </div>
              {goodsReturn.qcInspectedBy ? (
                <div className="field">
                  <span className="label">Inspected by</span>
                  <span title={goodsReturn.qcInspectedBy}>{userRefLabel(goodsReturn.qcInspectedBy, goodsReturn.qcInspectedByName)}</span>
                </div>
              ) : null}
              {goodsReturn.qcInspectedAt ? (
                <div className="field">
                  <span className="label">Inspected on</span>
                  <span>{formatIndianDate(goodsReturn.qcInspectedAt)}</span>
                </div>
              ) : null}
              {goodsReturn.qcNotes ? (
                <div className="field">
                  <span className="label">Inspector notes</span>
                  <span>{goodsReturn.qcNotes}</span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </Card>

      {blockedAsMaker ? (
        <p role="note" style={{ fontSize: 13, color: "#92400e", margin: "16px 0 0" }}>
          You recorded this return, so a different person must record its QC verdict.
        </p>
      ) : null}

      {isPending && !blockedAsMaker ? (
        <>
          <h2 style={{ margin: "24px 0 8px", fontSize: "1.1rem" }}>Record QC verdict</h2>
          <QcInspectionForm goodsReturnId={goodsReturn.id} qty={goodsReturn.qty} itemName={itemText} />
        </>
      ) : null}
    </>
  );
}
