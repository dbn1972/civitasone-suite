import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { getProcurementPOById } from "../../../../_data/loaders";
import { DispatchPOActions } from "./DispatchPOActions";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending Approval",
  approved: "Approved",
  dispatched: "Dispatched",
  partial_grn: "Partial GRN",
  fully_received: "Fully Received",
  cancelled: "Cancelled",
};

export default async function PODetailPage({ params }: { params: { id: string } }) {
  const { data: po, source } = await getProcurementPOById(params.id);

  if (!po) {
    return (
      <>
        <PageHeader title="Purchase Order" back="/procurement/orders" />
        <EmptyState icon="📦" title="Purchase order not found" message="This PO may have been removed or the ID is invalid." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={po.poNo}
        subtitle={po.vendor}
        back="/procurement/orders"
        actions={
          <>
            <PrintDocumentLink
              href={`/api/proxy/v1/procurement/pos/${po.id}/pdf`}
              label="Print PO"
            />
            <StatusPill status={po.status} label={STATUS_LABELS[po.status] ?? po.status} />
            <DispatchPOActions poId={po.id} canDispatch={po.status === "approved"} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <Card title="PO details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">PO No</span>
            <span className="mono">{po.poNo}</span>
          </div>
          <div className="field">
            <span className="label">Vendor</span>
            <span>{po.vendor}</span>
          </div>
          <div className="field">
            <span className="label">Total Amount</span>
            <span>₹{(po.totalAmount / 100).toLocaleString("en-IN")}</span>
          </div>
          <div className="field">
            <span className="label">Order Date</span>
            <span>{po.orderDate}</span>
          </div>
          <div className="field">
            <span className="label">Delivery Date</span>
            <span>{po.deliveryDate ?? "—"}</span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <StatusPill status={po.status} label={STATUS_LABELS[po.status] ?? po.status} />
          </div>
        </div>
      </Card>

      {po.lineItems.length > 0 && (
        <Card title="Line items">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Item Name</th>
                <th className="num">Ordered</th>
                <th>Unit</th>
                <th className="num">Unit Price</th>
                <th className="num">Total</th>
                <th className="num">GRN Qty</th>
              </tr>
            </thead>
            <tbody>
              {po.lineItems.map((item, i) => (
                <tr key={i}>
                  <td><span className="mono">{item.itemCode}</span></td>
                  <td>{item.itemName}</td>
                  <td className="num">{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td className="num">₹{(item.unitPrice / 100).toLocaleString("en-IN")}</td>
                  <td className="num">₹{(item.totalPrice / 100).toLocaleString("en-IN")}</td>
                  <td className="num" style={{ color: item.grnQty >= item.quantity ? "#16a34a" : "#d97706", fontWeight: 500 }}>
                    {item.grnQty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
