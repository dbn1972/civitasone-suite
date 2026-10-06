import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getRFQById } from "../../../../_data/loaders";
import { formatIndianDate, formatInternalRef } from "@/lib/formatters";
import { opaqueRefHref, parseOpaqueRef } from "@/lib/refs";
import { toHumanError } from "@/lib/messages";
import { ComparativeStatement, computeL1 } from "./ComparativeStatement";
import { RFQActions } from "./RFQActions";

type LineItemRow = Record<string, unknown> & {
  itemName: string;
  quantity: string;
  unit: string;
};

const LINE_ITEM_COLUMNS: { key: keyof LineItemRow; label: string; align?: "left" | "right" }[] = [
  { key: "itemName", label: "Item Name" },
  { key: "quantity", label: "Qty", align: "right" },
  { key: "unit", label: "Unit" },
];

export default async function RFQDetailPage({ params }: { params: { id: string } }) {
  const { data: rfq, source } = await getRFQById(params.id);

  if (!rfq) {
    // L3 fix: see indents/[id]/page.tsx — don't tell the officer an RFQ is
    // "removed or invalid" when the real cause was a fetch error.
    return (
      <>
        <PageHeader title="RFQ Detail" back="/procurement/rfq" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "RFQ" })} backHref="/procurement/rfq" />
        ) : (
          <EmptyState icon="📝" title="RFQ not found" message="This RFQ may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  const lineRows: LineItemRow[] = rfq.lineItems.map((item) => ({
    itemName: item.itemName,
    quantity: String(item.quantity),
    unit: item.unit,
  }));

  // GAP-PROCUREMENT-RFQ-DETAIL-04: resolve the opaque indent ref to a link; never
  // print the raw "procurement_indent:<uuid>". formatInternalRef guards a
  // malformed "...:undefined" ref down to "—".
  const indentHref = opaqueRefHref(rfq.indentRef);
  const indentParsed = parseOpaqueRef(rfq.indentRef);

  // GAP-PROCUREMENT-RFQ-DETAIL-01/-02: the award candidate is the L1 (lowest
  // unsealed) response — computed server-side so the Award action and the
  // comparative statement agree on the winner.
  const l1 = computeL1(rfq.responses);
  const awardCandidate = l1 && l1.totalAmountMinor !== undefined
    ? { responseId: l1.responseId, vendorName: l1.vendorName }
    : null;

  return (
    <>
      <PageHeader
        title={rfq.rfqNo}
        subtitle={rfq.title}
        back="/procurement/rfq"
        actions={
          <>
            <StatusPill status={rfq.status} />
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <Card title="RFQ details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">RFQ No</span>
            <span className="mono">{rfq.rfqNo}</span>
          </div>
          <div className="field">
            <span className="label">Indent Ref</span>
            {indentHref && indentParsed ? (
              <Link href={indentHref}>View indent</Link>
            ) : (
              <span>{formatInternalRef(rfq.indentRef)}</span>
            )}
          </div>
          <div className="field">
            <span className="label">Closing Date</span>
            <span>{formatIndianDate(rfq.closingDate)}</span>
          </div>
          <div className="field">
            <span className="label">Vendors Invited</span>
            <span>{rfq.vendorsInvited}</span>
          </div>
          <div className="field">
            <span className="label">Responses</span>
            <span>{rfq.responsesReceived}</span>
          </div>
          {rfq.description && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Description</span>
              {/* GAP-PROCUREMENT-RFQ-DETAIL-05: preserve line breaks in a
                  multi-line description instead of collapsing them. */}
              <span style={{ whiteSpace: "pre-wrap" }}>{rfq.description}</span>
            </div>
          )}
        </div>
      </Card>

      {/* GAP-PROCUREMENT-RFQ-DETAIL-01: lifecycle actions (close / award). */}
      <Card title="Actions" padding>
        <RFQActions
          rfqId={rfq.id}
          status={rfq.status}
          closingDate={rfq.closingDate}
          responseCount={rfq.responses.length}
          awardCandidate={awardCandidate}
        />
      </Card>

      {rfq.lineItems.length > 0 && (
        <Card title="Line items">
          <DataTable<LineItemRow>
            columns={LINE_ITEM_COLUMNS}
            rows={lineRows}
            pageSize={50}
          />
        </Card>
      )}

      {rfq.responses.length > 0 && (
        // GAP-PROCUREMENT-RFQ-DETAIL-02/-03: comparative statement with L1 marker
        // and sealed-amount discipline, replacing the flat total-only table.
        <Card title="Vendor responses (comparative statement)">
          <ComparativeStatement responses={rfq.responses} lineItems={rfq.lineItems} />
        </Card>
      )}
    </>
  );
}
