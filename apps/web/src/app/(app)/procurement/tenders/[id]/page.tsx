import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getProcurementTenderById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { TenderLifecycleActions } from "./TenderLifecycleActions";

const TYPE_LABELS: Record<string, string> = {
  open: "Open",
  limited: "Limited",
  single_source: "Single Source",
  gem: "GeM",
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

  const bidRows: BidRow[] = tender.bids.map((bid) => ({
    vendorName: bid.vendorName,
    // CRITICAL fix: bidAmount is undefined until the financial envelope is
    // opened (sealed-bid two-envelope process) — formatMoney() requires a
    // real bigint/number/string and cannot take undefined. Before this, the
    // page could only ever be reached once every bid happened to already be
    // financially opened, because the schema wrongly required this field and
    // the server 400'd on any sealed bid (see packages/schemas/src/web.ts).
    bidAmount: bid.bidAmount !== undefined ? formatMoney(bid.bidAmount) : "Sealed",
    technicalScore: bid.technicalScore != null ? String(bid.technicalScore) : "—",
    financialScore: bid.financialScore != null ? String(bid.financialScore) : "—",
    status: bid.status,
  }));

  return (
    <>
      <PageHeader
        title={tender.tenderNo}
        subtitle={tender.title}
        back="/procurement/tenders"
        actions={
          <>
            <StatusPill status={tender.type} label={TYPE_LABELS[tender.type] ?? tender.type} />
            <StatusPill status={tender.status} />
            <Link href={`/procurement/tenders/${tender.id}/documents`} className="btn ghost">Documents</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <TenderLifecycleActions tenderId={tender.id} status={tender.status} bids={tender.bids} />

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
        <Card title="Bids">
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
