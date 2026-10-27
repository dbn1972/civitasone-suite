import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getProcurementPOById } from "../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole, PROCUREMENT_WRITE_ROLES } from "@/lib/auth/roleGuard";
import Link from "next/link";
import { DispatchPOActions } from "./DispatchPOActions";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";
import { RaiseEOfficeNote } from "../../../../_components/RaiseEOfficeNote";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { PO_STATUS_LABELS } from "@/lib/procurement-status";

// /procurement/orders/[id]/amend is backed by POST /v1/procurement/pos/:id/amendments.
// Amendment is only meaningful once a PO is a real order (not still draft) and not final.
const AMENDABLE_STATUSES = new Set(["approved", "dispatched", "partial_grn", "gem_placed"]);

// GAP-PROCUREMENT-ORDERS-DETAIL-01 (D4c #19, owner decision 2026-10-27): a PO has
// exactly ONE release-approval path - the workflow inbox (maker-checker, role
// check, audit). An eOffice file note is OPTIONAL: it records administrative
// noting only (POST .../submit-approval) and never approves, cancels or gates the
// PO. It is only offered while the PO is still awaiting approval (draft or
// pending); the service state machine is the authority regardless.
const APPROVAL_RAISABLE_STATUSES = new Set(["draft", "pending"]);

// Plain-language description of where a PO sits in its single release path.
function approvalSummary(status: string): { label: string; detail: string } {
  switch (status) {
    case "draft":
    case "pending":
      return { label: "Awaiting approval", detail: "This PO is in the workflow inbox. An approver other than its creator decides it; approval releases it for dispatch." };
    case "approved":
      return { label: "Approved — ready to dispatch", detail: "This PO has been released by its workflow-inbox approval and can now be dispatched to the vendor." };
    case "gem_placed":
      return { label: "Placed on GeM", detail: "This order was placed through GeM; fulfilment is tracked via the GeM order." };
    case "dispatched":
      return { label: "Dispatched", detail: "This PO has been issued to the vendor." };
    case "partial_grn":
      return { label: "Partially received", detail: "Goods are being received against this dispatched PO." };
    case "fully_received":
      return { label: "Fully received", detail: "All goods on this PO have been received." };
    case "cancelled":
      return { label: "Cancelled", detail: "This PO was cancelled and cannot be released or dispatched." };
    case "closed":
      return { label: "Closed", detail: "This PO is closed." };
    default:
      return { label: PO_STATUS_LABELS[status] ?? status, detail: "" };
  }
}

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

export default async function PODetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { data: po, source } = await getProcurementPOById(params.id);

  if (!po) {
    return (
      <>
        <PageHeader title="Purchase Order" back="/procurement/orders" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "purchase order" })} backHref="/procurement/orders" />
        ) : (
          <EmptyState icon="📦" title="Purchase order not found" message="This PO may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  const canWrite = hasAnyRole(getSessionRoles(), PROCUREMENT_WRITE_ROLES);
  const approval = approvalSummary(po.status);

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
          // GAP-PROCUREMENT-ORDERS-DETAIL-04: a single wrap-friendly action group;
          // the status pill lives in the header only (not duplicated in the card).
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
            <PrintDocumentLink href={`/api/proxy/v1/procurement/pos/${po.id}/pdf`} label="Print PO" />
            <StatusPill status={po.status} label={PO_STATUS_LABELS[po.status] ?? po.status} />
            {canWrite && AMENDABLE_STATUSES.has(po.status) ? (
              <Link href={`/procurement/orders/${po.id}/amend`} className="btn ghost">Request amendment</Link>
            ) : null}
            <DispatchPOActions poId={po.id} status={po.status} canDispatchRole={canWrite} />
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </div>
        }
      />

      {/* GAP-PROCUREMENT-ORDERS-DETAIL-01: one Approval card states which decision
          releases the PO and where it currently sits — no competing path. */}
      <Card title="Approval" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Release path</span>
            <span>Workflow inbox approval (maker-checker)</span>
          </div>
          <div className="field">
            <span className="label">Current state</span>
            <StatusPill status={po.status} label={approval.label} />
          </div>
        </div>
        {approval.detail ? <p style={{ margin: "8px 0 0", color: "var(--mut)", fontSize: "0.875rem" }}>{approval.detail}</p> : null}
      </Card>

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
        </div>
      </Card>

      {/* Optional eOffice file note: only while awaiting approval, only for a role
          that can act on it (the service also 403s others). It never decides the PO. */}
      {canWrite && APPROVAL_RAISABLE_STATUSES.has(po.status) ? (
        <>
        <p style={{ margin: "0 0 8px", color: "var(--mut)", fontSize: "0.875rem" }} data-testid="eoffice-optional-note">
          Optional: an eOffice file note records administrative noting only. It does not approve or release this PO — approve it from the workflow inbox.
        </p>
        <RaiseEOfficeNote
          refType="procurement_po"
          refId={po.id}
          subject={`PO ${po.poNo} — ${po.vendor}`}
          dept="Procurement"
          amountMinor={po.totalAmount}
          defaultApprovalChain="file_noting"
          notifyPath={`/api/proxy/v1/procurement/pos/${po.id}/submit-approval`}
        />
        </>
      ) : null}

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
