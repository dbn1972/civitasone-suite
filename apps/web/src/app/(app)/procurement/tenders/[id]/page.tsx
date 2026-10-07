import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getProcurementTenderById } from "../../../../_data/loaders";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { TenderLifecycleActions } from "./TenderLifecycleActions";

const TYPE_LABELS: Record<string, string> = {
  open: "Open",
  limited: "Limited",
  single_source: "Single Source",
  gem: "GeM",
};

// GAP-PROCUREMENT-TENDERS-02 / DETAIL-02: human labels for the real evaluation
// phases (the collapsed "evaluation" is kept for older payloads).
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  evaluation: "Under Evaluation",
  technical_evaluation: "Technical Evaluation",
  financial_evaluation: "Financial Evaluation",
  awarded: "Awarded",
  cancelled: "Cancelled",
};

type BidRow = Record<string, unknown> & {
  vendorName: string;
  bidAmount: string;
  technicalScore: string;
  financialScore: string;
  status: string;
};

const BID_COLUMNS: { key: keyof BidRow; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
  { key: "vendorName", label: "Vendor" },
  { key: "bidAmount", label: "Bid Amount", align: "right" },
  { key: "technicalScore", label: "Technical", align: "right" },
  { key: "financialScore", label: "Financial", align: "right" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function TenderDetailPage({ params }: { params: { id: string } }) {
  const { data: tender, source } = await getProcurementTenderById(params.id);

  if (!tender) {
    // L3 fix: see indents/[id]/page.tsx — don't tell the officer a tender is
    // "removed or invalid" when the real cause was a fetch error.
    return (
      <>
        <PageHeader title="Tender Detail" back="/procurement/tenders" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "tender" })} backHref="/procurement/tenders" />
        ) : (
          <EmptyState icon="🏛️" title="Tender not found" message="This tender may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  // GAP-PROCUREMENT-TENDERS-DETAIL-04 (bid confidentiality, GFR vigilance): the
  // register of WHO bid is confidential until the technical envelopes have been
  // opened. While the tender is only "published" (bids received, nothing
  // opened), show "Bidder N" and the count, never the vendor identity. Once the
  // tender moves to technical_evaluation (opening has occurred for the
  // committee) the names appear. DECISION (safest default; flagged for HUMAN
  // REVIEW): the stronger fix is for the API to OMIT vendorName before opening
  // for non-committee roles — this display masking is honest and fail-closed in
  // the meantime.
  const beforeOpening = tender.status === "published";

  const bidRows: BidRow[] = tender.bids.map((bid, i) => ({
    vendorName: beforeOpening ? `Bidder ${i + 1}` : bid.vendorName,
    // CRITICAL fix: bidAmount is undefined until the financial envelope is
    // opened (sealed-bid two-envelope process).
    bidAmount: bid.bidAmount !== undefined ? formatMoney(bid.bidAmount) : "Sealed",
    technicalScore: bid.technicalScore != null ? String(bid.technicalScore) : "—",
    financialScore: bid.financialScore != null ? String(bid.financialScore) : "—",
    status: bid.status,
  }));

  // GAP-PROCUREMENT-TENDERS-DETAIL-03 (maker-checker, UI side): the award
  // approver must differ from the tender's creator AND its technical evaluator.
  // The server stays authoritative (award consumer re-checks SoD in-txn and
  // 403s a self-award); this only decides whether the UI offers an enabled
  // Award button and shows the reason, instead of letting the officer discover
  // the block from a raw 403.
  const sessionUserId = getSessionUserId();
  let canAward = true;
  let awardBlockReason: string | undefined;
  if (sessionUserId) {
    if (tender.createdBy && sessionUserId === tender.createdBy) {
      canAward = false;
      awardBlockReason = "You created this tender — the approver must differ from the creator.";
    } else if (tender.techEvaluatedBy && sessionUserId === tender.techEvaluatedBy) {
      canAward = false;
      awardBlockReason = "You evaluated this tender technically — the approver must differ from the evaluator.";
    }
  }

  const docCount = tender.documentCount ?? 0;
  const nitPresent = tender.hasNit === true;

  return (
    <>
      <PageHeader
        title={tender.tenderNo}
        subtitle={tender.title}
        back="/procurement/tenders"
        actions={
          <>
            <StatusPill status={tender.type} label={TYPE_LABELS[tender.type] ?? tender.type} />
            <StatusPill status={tender.status} label={STATUS_LABELS[tender.status]} />
            <Link href={`/procurement/tenders/${tender.id}/documents`} className="btn ghost">
              Documents{docCount > 0 ? ` (${docCount})` : ""}
            </Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      {/* GAP-PROCUREMENT-TENDERS-DETAIL-05: NIT-missing cue (publishing without a
          NIT is a compliance risk). */}
      {tender.status === "draft" && !nitPresent ? (
        <div className="card pad" style={{ marginTop: 12, borderInlineStart: "3px solid var(--warn)" }} role="note">
          <strong>No NIT attached.</strong> Attach the Notice Inviting Tender before publishing.{" "}
          <Link href={`/procurement/tenders/${tender.id}/documents`}>Add documents</Link>
        </div>
      ) : null}

      <TenderLifecycleActions
        tenderId={tender.id}
        status={tender.status}
        bids={tender.bids}
        canAward={canAward}
        awardBlockReason={awardBlockReason}
      />

      <Card title="Tender details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Tender No</span>
            <span className="mono">{tender.tenderNo}</span>
          </div>
          <div className="field">
            <span className="label">Est. Value</span>
            <span>{formatMoney(tender.estimatedValue)}</span>
          </div>
          {/* GAP-PROCUREMENT-TENDERS-DETAIL-05: EMD surfaced on the detail page. */}
          {tender.emdAmountMinor != null && (
            <div className="field">
              <span className="label">EMD</span>
              <span>{formatMoney(tender.emdAmountMinor)}</span>
            </div>
          )}
          {tender.publishDate && (
            <div className="field">
              <span className="label">Publish Date</span>
              <span>{formatIndianDate(tender.publishDate)}</span>
            </div>
          )}
          <div className="field">
            <span className="label">Bid Closing</span>
            <span>{formatIndianDate(tender.bidClosingDate)}</span>
          </div>
          {tender.openingDate && (
            <div className="field">
              <span className="label">Opening Date</span>
              <span>{formatIndianDate(tender.openingDate)}</span>
            </div>
          )}
          <div className="field">
            <span className="label">Bids Received</span>
            <span>{tender.bidsReceived}</span>
          </div>
          {tender.scope && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Scope</span>
              <span>{tender.scope}</span>
            </div>
          )}
          {tender.eligibilityCriteria && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Eligibility</span>
              <span>{tender.eligibilityCriteria}</span>
            </div>
          )}
        </div>
      </Card>

      {tender.bids.length > 0 && (
        <Card title={beforeOpening ? "Bids (sealed — bidder identities hidden until opening)" : "Bids"}>
          <DataTable<BidRow>
            columns={BID_COLUMNS}
            rows={bidRows}
            pageSize={25}
          />
        </Card>
      )}
    </>
  );
}
