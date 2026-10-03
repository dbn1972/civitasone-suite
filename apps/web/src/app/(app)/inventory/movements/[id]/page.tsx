import { PageHeader, Card, StatusPill, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { getInventoryMovementById } from "../../_data";
import { itemLabel, nameOrDash, receiptDocLabels, userRefLabel } from "../../_labels";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  receipt: "Receipt",
  issue: "Issue",
  transfer: "Transfer",
  adjustment: "Stock adjustment",
};

// GAP-INVENTORY-CYCLE-COUNTS-DETAIL-05: read-only view of a posted stock movement, the
// target of "View stock adjustment" on an approved cycle count.
export default async function InventoryMovementDetailPage({ params }: { params: { id: string } }) {
  const result = await getInventoryMovementById(params.id);
  const movement = result.data;

  if (result.source === "error" && result.status !== 404) {
    return (
      <>
        <PageHeader title="Stock movement" back="/inventory/list" />
        <LoadErrorState result={result} area="stock movement" backHref="/inventory/list" />
      </>
    );
  }
  if (!movement) {
    return (
      <>
        <PageHeader title="Stock movement" back="/inventory/list" />
        <EmptyState
          icon="📒"
          title="Stock movement not found"
          message="This movement may not have been posted yet, or you don't have access to it."
        />
      </>
    );
  }

  const { grn, po } = receiptDocLabels(movement);
  const typeLabel = TYPE_LABELS[movement.movementType] ?? movement.movementType;

  return (
    <>
      <PageHeader
        title={typeLabel}
        subtitle={`Posted ${formatIndianDate(movement.postingDate)}`}
        back="/inventory/list"
        actions={<StatusPill status={movement.status} />}
      />
      <Card title="Movement details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Type</span>
            <span>{typeLabel}</span>
          </div>
          {movement.fromStoreId ? (
            <div className="field">
              <span className="label">From store</span>
              <span title={movement.fromStoreId}>{nameOrDash(movement.fromStoreName)}</span>
            </div>
          ) : null}
          {movement.toStoreId ? (
            <div className="field">
              <span className="label">To store</span>
              <span title={movement.toStoreId}>{nameOrDash(movement.toStoreName)}</span>
            </div>
          ) : null}
          {grn ? (
            <div className="field">
              <span className="label">GRN</span>
              <span>{grn}</span>
            </div>
          ) : null}
          {po ? (
            <div className="field">
              <span className="label">PO</span>
              <span>{po}</span>
            </div>
          ) : null}
          {movement.reasonCode ? (
            <div className="field">
              <span className="label">Reason code</span>
              <span>{movement.reasonCode}</span>
            </div>
          ) : null}
          {movement.notes ? (
            <div className="field">
              <span className="label">Notes</span>
              <span>{movement.notes}</span>
            </div>
          ) : null}
          <div className="field">
            <span className="label">Posted by</span>
            <span title={movement.createdBy ?? undefined}>{userRefLabel(movement.createdBy, movement.createdByName)}</span>
          </div>
        </div>
      </Card>
      <Card title="Lines" padding>
        {movement.lines.length === 0 ? (
          <p style={{ fontSize: 13, color: "#475569" }}>This movement has no recorded lines.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "left" }}>Item</th>
                <th scope="col" style={{ textAlign: "right" }}>Qty</th>
                <th scope="col" style={{ textAlign: "right" }}>Rate</th>
                <th scope="col" style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {movement.lines.map((l) => (
                <tr key={l.id}>
                  <td title={l.itemId}>{itemLabel(l)}</td>
                  <td style={{ textAlign: "right" }}>{l.qty}</td>
                  <td style={{ textAlign: "right" }}>{formatMoney(l.rateMinor)}</td>
                  <td style={{ textAlign: "right" }}>{formatMoney(l.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
