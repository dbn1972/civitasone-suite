import { PageHeader, Card, StatusPill, EmptyState, ErrorState } from "@/app/_components/ds";
import { getProcurementPOById } from "../../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { PO_STATUS_LABELS } from "@/lib/procurement-status";
import { AmendForm } from "./AmendForm";

// GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-01: amendment is only meaningful on a
// live order (not draft, not terminal). Mirrors the backend assertPoAmendable
// (amendment-domain.ts): approved / dispatched / partial_grn / gem_placed.
const AMENDABLE_STATUSES = new Set(["approved", "dispatched", "partial_grn", "gem_placed"]);

export default async function POAmendPage({ params }: { params: { id: string } }) {
  const { data: po, source } = await getProcurementPOById(params.id);

  if (!po) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Request PO Amendment" back={`/procurement/orders/${params.id}`} backLabel="Purchase Order" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "purchase order" })} backHref={`/procurement/orders/${params.id}`} />
        ) : (
          <EmptyState icon="📦" title="Purchase order not found" message="This PO may have been removed or the ID is invalid." />
        )}
      </div>
    );
  }

  const amendable = AMENDABLE_STATUSES.has(po.status);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <div style={{ maxWidth: 720 }}>
        <PageHeader
          title={`Request amendment — ${po.poNo}`}
          subtitle={po.vendor}
          back={`/procurement/orders/${po.id}`}
          backLabel="Purchase Order"
          help="procurement"
        />

        <Card title="Purchase order" padding>
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
              <span className="label">Status</span>
              <StatusPill status={po.status} label={PO_STATUS_LABELS[po.status] ?? po.status} />
            </div>
            <div className="field">
              <span className="label">Current total</span>
              <span>{formatMoney(po.totalAmount)}</span>
            </div>
            <div className="field">
              <span className="label">Delivery date</span>
              <span>{po.deliveryDate ? formatIndianDate(po.deliveryDate) : "—"}</span>
            </div>
          </div>
        </Card>

        {amendable ? (
          <AmendForm poId={po.id} currentTotalMinor={po.totalAmount} lineItems={po.lineItems} />
        ) : (
          <EmptyState
            icon="🔒"
            title="This PO cannot be amended"
            message={`A PO in status "${PO_STATUS_LABELS[po.status] ?? po.status}" is not amendable. Only approved, dispatched, partially-received or GeM-placed POs can be amended.`}
          />
        )}
      </div>
    </div>
  );
}
