import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, DataTable } from "../../../../_components/ds";
import { getProcurementPOById } from "../../../../_data/loaders";
import { DispatchPOActions } from "./DispatchPOActions";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";
import { RaiseEOfficeNote } from "../../../../_components/RaiseEOfficeNote";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending Approval",
  approved: "Approved",
  dispatched: "Dispatched",
  partial_grn: "Partial GRN",
  fully_received: "Fully Received",
  cancelled: "Cancelled",
};

type LineItemRow = Record<string, unknown> & {
  itemCode: string;
  itemName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  totalPrice: string;
  grnQty: string;
};

const LINE_ITEM_COLUMNS: { key: keyof LineItemRow; label: string; align?: "left" | "right" }[] = [
  { key: "itemCode", label: "Item Code" },
  { key: "itemName", label: "Item Name" },
  { key: "quantity", label: "Ordered", align: "right" },
  { key: "unit", label: "Unit" },
  { key: "unitPrice", label: "Unit Price", align: "right" },
  { key: "totalPrice", label: "Total", align: "right" },
  { key: "grnQty", label: "GRN Qty", align: "right" },
];

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

  const lineRows: LineItemRow[] = po.lineItems.map((item) => ({
    itemCode: item.itemCode,
    itemName: item.itemName,
    quantity: String(item.quantity),
    unit: item.unit,
    unitPrice: formatMoney(item.unitPrice),
    totalPrice: formatMoney(item.totalPrice),
    grnQty: String(item.grnQty),
  }));

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
            <span>{formatMoney(po.totalAmount)}</span>
          </div>
          <div className="field">
            <span className="label">Order Date</span>
            <span>{formatIndianDate(po.orderDate)}</span>
          </div>
          <div className="field">
            <span className="label">Delivery Date</span>
            <span>{po.deliveryDate ? formatIndianDate(po.deliveryDate) : "—"}</span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <StatusPill status={po.status} label={STATUS_LABELS[po.status] ?? po.status} />
          </div>
        </div>
      </Card>

      <RaiseEOfficeNote
        refType="procurement_po"
        refId={po.id}
        subject={`PO ${po.poNo} — ${po.vendor}`}
        dept="Procurement"
        amountMinor={po.totalAmount}
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/procurement/pos/${po.id}/submit-approval`}
      />

      {po.lineItems.length > 0 && (
        <Card title="Line items">
          <DataTable<LineItemRow>
            columns={LINE_ITEM_COLUMNS}
            rows={lineRows}
            pageSize={50}
          />
        </Card>
      )}
    </>
  );
}
