import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getProcurementGRNById, getSrnByGrn } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { AmendGrnForm } from "./AmendGrnForm";
import { InspectGrnForm } from "./InspectGrnForm";
import { grnStatusLabel } from "../statusLabels";
import { parsePoRef } from "../poRef";


// Req 1.2 — GRN partial-delivery amendment. Only editable while `draft` or
// `under_inspection`; the server rejects a PATCH after that with 409
// GRN_NOT_AMENDABLE, so the UI gate mirrors the same rule.
function canAmendGrn(status: string): boolean {
  return status === "draft" || status === "under_inspection";
}

// DOM-002 — a GRN can be inspected (accepted/rejected) while it's still
// awaiting inspection; the server rejects a PATCH .../accept|reject after
// that with 409 GRN_NOT_INSPECTABLE, so the UI gate mirrors the same rule.
function canInspectGrn(status: string): boolean {
  return status === "draft" || status === "under_inspection";
}

type ItemRow = Record<string, unknown> & {
  itemCode: string;
  poItemRef: string;
  orderedQty: string;
  receivedQty: string;
  acceptedQty: string;
  unit: string;
};

const ITEM_COLUMNS: { key: keyof ItemRow; label: string; align?: "left" | "right" }[] = [
  { key: "itemCode", label: "Item code" },
  { key: "poItemRef", label: "PO item ref" },
  { key: "orderedQty", label: "Ordered", align: "right" },
  { key: "receivedQty", label: "Received", align: "right" },
  { key: "acceptedQty", label: "Accepted", align: "right" },
  { key: "unit", label: "Unit" },
];

export default async function GRNDetailPage({ params }: { params: { id: string } }) {
  const [{ data: grn, source }, { data: srn, source: srnSource, status: srnStatus }] = await Promise.all([
    getProcurementGRNById(params.id),
    getSrnByGrn(params.id),
  ]);
  // GAP-PROCUREMENT-GRN-DETAIL-03 — the viewer's own user id, for an up-front
  // separation-of-duties hint (the server stays authoritative).
  const viewerId = getSessionUserId();

  if (!grn) {
    // L3 fix: see indents/[id]/page.tsx — don't tell the officer a GRN is
    // "removed or invalid" when the real cause was a fetch error.
    return (
      <>
        <PageHeader title="Goods Receipt Note" back="/procurement/grn" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "GRN" })} backHref="/procurement/grn" />
        ) : (
          <EmptyState icon="📦" title="GRN not found" message="This GRN may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  const itemRows: ItemRow[] = grn.items.map((item) => ({
    itemCode: item.itemCode,
    poItemRef: item.poItemRef,
    orderedQty: String(item.orderedQty),
    receivedQty: String(item.receivedQty),
    acceptedQty: String(item.acceptedQty),
    unit: item.unit,
  }));

  // GAP2-PROCUREMENT-GRN-DETAIL-06 — the service resolves the opaque
  // `procurement_po:<uuid>` reference to its bare uuid (poId, for the link href)
  // and human PO number (poNo, for display). parsePoRef is kept as a defensive
  // fallback if an older payload omits poId. Never render the raw composite.
  const poId = grn.poId ?? parsePoRef(grn.poRef);
  const poNumber = grn.poNo ?? null;

  // GAP-PROCUREMENT-GRN-DETAIL-02 — the match is only "known" once computed
  // (post-inspection). An uninspected GRN must read as a neutral pending state,
  // never a red mismatch.
  const matchKnown = grn.threeWayMatch !== undefined;

  // GAP-PROCUREMENT-GRN-DETAIL-05 — distinguish a failed SRN lookup from a
  // genuine "no SRN yet". fetchJson returns source 'error' with a status on any
  // non-2xx/network failure; a real 404 (or source 'api' with null) means no SRN
  // exists. Only offer "Create SRN" when we actually know none exists.
  const srnUnknown = !srn && srnSource === "error" && srnStatus !== 404;

  // GAP-PROCUREMENT-GRN-DETAIL-03 — the viewer created this GRN, so SoD bars them
  // from inspecting it; disable the actions up front (server still enforces).
  const isCreator = Boolean(viewerId && grn.createdBy && viewerId === grn.createdBy);

  return (
    <>
      <PageHeader
        title={grn.grnNo}
        subtitle={grn.vendor}
        back="/procurement/grn"
        actions={
          <>
            {matchKnown ? (
              <StatusPill
                status={grn.threeWayMatch ? "accepted" : "rejected"}
                label={grn.threeWayMatch ? "Three-way match" : "Three-way mismatch"}
              />
            ) : (
              <StatusPill status="pending" label="Match pending inspection" />
            )}
            <StatusPill status={grn.status} label={grnStatusLabel(grn.status)} />
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <Card title="GRN details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">GRN No</span>
            <span className="mono">{grn.grnNo}</span>
          </div>
          <div className="field">
            <span className="label">PO Ref</span>
            {poId ? (
              <Link href={`/procurement/orders/${poId}`} className="mono">{poNumber ?? "View purchase order"}</Link>
            ) : (
              <span className="mono">—</span>
            )}
          </div>
          <div className="field">
            <span className="label">Vendor</span>
            <span>{grn.vendor}</span>
          </div>
          <div className="field">
            <span className="label">Received date</span>
            <span>{formatIndianDate(grn.receivedDate)}</span>
          </div>
          <div className="field">
            <span className="label">Three-way match</span>
            {matchKnown ? (
              <span style={{ color: grn.threeWayMatch ? "#16a34a" : "#b91c1c", fontWeight: 600 }}>
                {grn.threeWayMatch ? "Matched (PO · receipt · inspection)" : "Not matched"}
              </span>
            ) : (
              // GAP-PROCUREMENT-GRN-DETAIL-02 — neutral, not red: the match has not
              // been computed because the GRN has not been inspected yet.
              <span style={{ color: "var(--muted, #6b7280)", fontWeight: 600 }}>Pending inspection</span>
            )}
          </div>
          <div className="field">
            <span className="label">Store Receipt Note (SRN)</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {srn ? (
                <>
                  <StatusPill status={srn.status} label={srn.status === "signed" ? "Signed" : "Draft"} />
                  <Link href={`/procurement/grn/${grn.id}/srn`}>View SRN</Link>
                </>
              ) : srnUnknown ? (
                // GAP-PROCUREMENT-GRN-DETAIL-05 — the SRN lookup failed; do NOT
                // offer "Create SRN" (a GRN may already have a signed SRN we just
                // couldn't read — creating a second one would be a duplicate on a
                // payment gate).
                <>
                  <StatusPill status="pending" label="Unavailable" />
                  <span style={{ fontSize: "0.8125rem", color: "var(--muted, #6b7280)" }}>Couldn&apos;t check SRN — refresh</span>
                </>
              ) : (
                <>
                  <StatusPill status="draft" label="Not created" />
                  <Link href={`/procurement/grn/${grn.id}/srn/new`}>Create SRN</Link>
                </>
              )}
            </span>
          </div>
          {grn.notes ? (
            <div className="field">
              <span className="label">Notes</span>
              <span>{grn.notes}</span>
            </div>
          ) : null}
        </div>
      </Card>

      {grn.inspection ? (
        <Card title="Quality inspection" padding>
          <div className="fields">
            <div className="field">
              <span className="label">Result</span>
              <StatusPill status={grn.inspection.result === "pass" ? "accepted" : "rejected"} label={grn.inspection.result} />
            </div>
            <div className="field">
              <span className="label">Inspection date</span>
              <span>{formatIndianDate(grn.inspection.inspectionDate)}</span>
            </div>
            {grn.inspection.remarks ? (
              <div className="field">
                <span className="label">Remarks</span>
                <span>{grn.inspection.remarks}</span>
              </div>
            ) : null}
          </div>
        </Card>
      ) : canInspectGrn(grn.status) ? (
        // DOM-002 — this GRN was received but has not yet been inspected. A
        // DIFFERENT, independently authenticated officer from whoever
        // created it must accept or reject it here; the server enforces
        // that separation (403 SOD_VIOLATION otherwise), this is just the UI
        // entry point.
        <Card title="Inspection required" padding>
          <InspectGrnForm grnId={grn.id} grnNo={grn.grnNo} isCreator={isCreator} />
        </Card>
      ) : null}

      {grn.items.length > 0 && canAmendGrn(grn.status) ? (
        <Card title="Amend received items" padding>
          <p style={{ marginBottom: 12, fontSize: "0.875rem", color: "var(--muted, #6b7280)" }}>
            This GRN is still {grnStatusLabel(grn.status)} — update received and accepted
            quantities to record a partial delivery. GRN number, vendor, and PO reference cannot be changed.
          </p>
          <AmendGrnForm grnId={grn.id} items={grn.items} />
        </Card>
      ) : grn.items.length > 0 ? (
        <Card title="Received items">
          <DataTable<ItemRow>
            columns={ITEM_COLUMNS}
            rows={itemRows}
            pageSize={50}
          />
        </Card>
      ) : null}
    </>
  );
}
