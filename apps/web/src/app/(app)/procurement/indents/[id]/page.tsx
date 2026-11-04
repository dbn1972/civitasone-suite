import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, EmptyState, ErrorState, DataTable, RecordHeader, DetailList, ApprovalTrail } from "../../../../_components/ds";
import { getProcurementIndentById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { resolveRecordRefs } from "@/lib/records/recordRefs";
import { personLabel } from "@/lib/records/labels";
import { isTerminalStatus, outcomeLine } from "@/lib/records/statusActions";
import { INDENT_STATUS_RULE } from "@/lib/records/status/indent";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  tender_required: "Tender Required",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_po: "Converted to PO",
  closed: "Closed",
};

// GAP-PROCUREMENT-INDENTS-DETAIL-01: the detail page used to be a dead end —
// no contextual next step for a status that implies one. These link to
// surfaces that already exist and enforce their own roles (approvals queue;
// PO creation; tender creation). We intentionally do NOT pass an indent id
// query param: orders/new and tenders/new do not yet consume one (verified
// against their page.tsx), so a prefill link would silently do nothing —
// linking to the plain creation route is honest and still removes the dead
// end. Statuses with no actionable next step (draft/converted_to_po/closed)
// get none.
const NEXT_STEP: Record<string, { href: string; label: string }> = {
  pending_approval: { href: "/procurement/approvals", label: "View in approvals" },
  tender_required: { href: "/procurement/tenders/new", label: "Create tender" },
  approved: { href: "/procurement/orders/new", label: "Create purchase order" },
};

type LineItemRow = Record<string, unknown> & {
  itemCode: string;
  itemName: string;
  quantity: string;
  unit: string;
  estimatedUnitPrice: string;
  totalPrice: string;
};

const LINE_ITEM_COLUMNS: { key: keyof LineItemRow; label: string; align?: "left" | "right" }[] = [
  { key: "itemCode", label: "Item Code" },
  { key: "itemName", label: "Item Name" },
  { key: "quantity", label: "Qty", align: "right" },
  { key: "unit", label: "Unit" },
  { key: "estimatedUnitPrice", label: "Est. Unit Price", align: "right" },
  { key: "totalPrice", label: "Total", align: "right" },
];

export default async function IndentDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const tw = await getTranslations("procurement.w2b.indentDetail");
  const { data: indent, source } = await getProcurementIndentById(params.id);

  if (!indent) {
    // L3 fix: a fetch failure and a genuine bad id were both rendered as
    // "may have been removed or invalid" (EmptyState), which is a truthfulness
    // bug — on a real fetch error this tells the officer the wrong thing
    // (implies the indent is gone/bad, when the server just couldn't be
    // reached). `source === "error"` is the same signal already used for
    // DataSourceBadge above; use it here too, and use ErrorState (role="alert",
    // a working "back" action) instead of EmptyState for the genuine-error case.
    return (
      <>
        <PageHeader title="Indent Detail" back="/procurement/indents" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "indent" })} backHref="/procurement/indents" />
        ) : (
          <EmptyState icon="📋" title="Indent not found" message="This indent may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  const lineRows: LineItemRow[] = indent.lineItems.map((item) => ({
    itemCode: item.itemCode,
    itemName: item.itemName,
    quantity: String(item.quantity),
    unit: item.unit,
    estimatedUnitPrice: formatMoney(item.estimatedUnitPrice),
    totalPrice: formatMoney(item.totalPrice),
  }));

  // UX-R5: one batched, tenant-scoped lookup for the requester and every trail actor (name + designation).
  const refs = await resolveRecordRefs({ people: [indent.requestedById, ...indent.approvalTrail.map((st) => st.actorId)] });
  const requester = personLabel(refs.people, indent.requestedById, indent.requestedBy);
  const trail = indent.approvalTrail.map((step, i) => {
    // GAP-PROCUREMENT-INDENTS-DETAIL-03: a rejection reason must stand out from an ordinary remark, with an explicit label.
    const isRejection = /reject/i.test(step.action);
    return {
      key: `${i}`,
      actor: personLabel(refs.people, step.actorId, step.actor),
      action: step.action,
      // GAP-PROCUREMENT-INDENTS-DETAIL-03: ISO -> Indian date+time (Asia/Kolkata), never the raw string.
      at: step.timestamp,
      remarks: step.remarks ? (isRejection ? `Reason: ${step.remarks}` : step.remarks) : null,
    };
  });
  const finished = isTerminalStatus(INDENT_STATUS_RULE, indent.status);
  const decision = [...indent.approvalTrail].reverse().find((st) => /reject|approv/i.test(st.action));
  const outcome = finished
    ? outcomeLine({
        status: indent.status === "converted_to_po" ? "converted" : indent.status,
        by: indent.status === "rejected" && decision ? personLabel(refs.people, decision.actorId, decision.actor) : null,
        at: indent.status === "rejected" ? decision?.timestamp ?? null : null,
      })
    : null;
  const next = NEXT_STEP[indent.status];

  return (
    <>
      <RecordHeader
        kind="Indent"
        recordNo={indent.indentNo}
        subtitle={indent.department}
        status={indent.status}
        statusLabel={STATUS_LABELS[indent.status] ?? indent.status}
        amountMinor={indent.estimatedAmount}
        amountLabel="Estimated amount"
        parties={[{ label: "Requested by", value: requester }]}
        // GAP-PROCUREMENT-INDENTS-DETAIL-01: the one contextual next step for this status, in the same place.
        primaryAction={next ? <Link href={next.href} className="btn primary">{next.label}</Link> : undefined}
        secondaryActions={source === "error" ? <DataSourceBadge source={source} /> : undefined}
        outcome={outcome}
        back="/procurement/indents"
        backLabel="Indents"
      />
      <Card title="Indent details" padding>
        <DetailList
          ariaLabel="Indent details"
          items={[
            { label: "Indent no.", value: indent.indentNo, mono: true },
            { label: "Department", value: indent.department },
            { label: "Requested by", value: requester },
            { label: "Estimated amount", value: formatMoney(indent.estimatedAmount) },
            { label: "Request date", value: formatIndianDate(indent.requestDate) },
            { label: "Required by", value: indent.requiredByDate ? formatIndianDate(indent.requiredByDate) : null },
            // GAP-PROCUREMENT-INDENTS-DETAIL-02: an approver needs to see WHY the purchase is requested.
            { label: "Purpose / justification", value: indent.purpose && indent.purpose.trim() ? indent.purpose : null, wide: true },
          ]}
        />
      </Card>
      {indent.lineItems.length > 0 && (
        <Card title="Line items">
          <DataTable<LineItemRow>
            columns={LINE_ITEM_COLUMNS}
            rows={lineRows}
            pageSize={50}
          />
        </Card>
      )}
      {/* GAP-PROCUREMENT-INDENTS-DETAIL-05: the trail comes from the workflow engine.
          If it could not be asked, say so - an empty trail on an indent that WAS
          decided must not read as "no decisions". */}
      {indent.approvalTrailAvailable === false ? (
        <div className="card pad" role="status" style={{ marginTop: 12, borderInlineStart: "3px solid var(--warn)" }}>
          {tw("trailUnavailable")}
        </div>
      ) : (
        <ApprovalTrail entries={trail} />
      )}
    </>
  );
}
