import { PageHeader, Card, StatusPill, EmptyState } from "@/app/_components/ds";
import { getGoodsReturnById } from "@/app/_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { QcInspectionForm } from "./QcInspectionForm";

export default async function GoodsReturnDetailPage({ params }: { params: { id: string } }) {
  const { data: goodsReturn } = await getGoodsReturnById(params.id);

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
            <span className="label">Original issue (GRN reference)</span>
            <span className="mono">{goodsReturn.originalIssueId}</span>
          </div>
          <div className="field">
            <span className="label">Item</span>
            <span className="mono">{goodsReturn.itemId}</span>
          </div>
          <div className="field">
            <span className="label">Store</span>
            <span className="mono">{goodsReturn.storeId}</span>
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
          {!isPending ? (
            <>
              <div className="field">
                <span className="label">QC verdict</span>
                <StatusPill status={goodsReturn.qcStatus} />
              </div>
              <div className="field">
                <span className="label">Disposition</span>
                <StatusPill status={goodsReturn.disposition} />
              </div>
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

      {isPending ? (
        <>
          <h2 style={{ margin: "24px 0 8px", fontSize: "1.1rem" }}>Record QC verdict</h2>
          <QcInspectionForm goodsReturnId={goodsReturn.id} />
        </>
      ) : null}
    </>
  );
}
