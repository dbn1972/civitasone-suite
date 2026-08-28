import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getProcurementGRNById, getSrnByGrn } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { AmendGrnForm } from "./AmendGrnForm";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  under_inspection: "Under Inspection",
  received: "Received",
  quality_check: "Quality Check",
  accepted: "Accepted",
  partially_rejected: "Partially Rejected",
  rejected: "Rejected",
};

// Req 1.2 — GRN partial-delivery amendment. Only editable while `draft` or
// `under_inspection`; the server rejects a PATCH after that with 409
// GRN_NOT_AMENDABLE, so the UI gate mirrors the same rule.
function canAmendGrn(status: string): boolean {
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
  const [{ data: grn, source }, { data: srn }] = await Promise.all([
    getProcurementGRNById(params.id),
    getSrnByGrn(params.id),
  ]);

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

  return (
    <>
      <PageHeader
        title={grn.grnNo}
        subtitle={grn.vendor}
        back="/procurement/grn"
        actions={
          <>
            <StatusPill
              status={grn.threeWayMatch ? "accepted" : "rejected"}
              label={grn.threeWayMatch ? "Three-way match" : "Three-way mismatch"}
            />
            <StatusPill status={grn.status} label={STATUS_LABELS[grn.status] ?? grn.status} />
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
            <span className="mono">{grn.poRef}</span>
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
            <span style={{ color: grn.threeWayMatch ? "#16a34a" : "#b91c1c", fontWeight: 600 }}>
              {grn.threeWayMatch ? "Matched (PO · receipt · inspection)" : "Not matched"}
            </span>
          </div>
          <div className="field">
            <span className="label">Store Receipt Note (SRN)</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {srn ? (
                <>
                  <StatusPill status={srn.status} label={srn.status === "signed" ? "Signed" : "Draft"} />
                  <Link href={`/procurement/grn/${grn.id}/srn`}>View SRN</Link>
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
      ) : null}

      {grn.items.length > 0 && canAmendGrn(grn.status) ? (
        <Card title="Amend received items" padding>
          <p style={{ marginBottom: 12, fontSize: "0.875rem", color: "var(--muted, #6b7280)" }}>
            This GRN is still {STATUS_LABELS[grn.status] ?? grn.status} — update received and accepted
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
