import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, DataTable } from "../../../../_components/ds";
import { getProcurementTenderById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

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
    return (
      <>
        <PageHeader title="Tender Detail" back="/procurement/tenders" />
        <EmptyState icon="🏛️" title="Tender not found" message="This tender may have been removed or the ID is invalid." />
      </>
    );
  }

  const bidRows: BidRow[] = tender.bids.map((bid) => ({
    vendorName: bid.vendorName,
    bidAmount: formatMoney(bid.bidAmount),
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
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
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
