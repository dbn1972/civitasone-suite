import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { getProcurementTenderById } from "../../../../_data/loaders";

const TYPE_LABELS: Record<string, string> = {
  open: "Open",
  limited: "Limited",
  single_source: "Single Source",
  gem: "GeM",
};

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
            <span>₹{(tender.estimatedValue / 100).toLocaleString("en-IN")}</span>
          </div>
          {tender.publishDate && (
            <div className="field">
              <span className="label">Publish Date</span>
              <span>{tender.publishDate}</span>
            </div>
          )}
          <div className="field">
            <span className="label">Bid Closing</span>
            <span>{tender.bidClosingDate}</span>
          </div>
          {tender.openingDate && (
            <div className="field">
              <span className="label">Opening Date</span>
              <span>{tender.openingDate}</span>
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
          <table className="tbl">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="num">Bid Amount</th>
                <th className="num">Technical</th>
                <th className="num">Financial</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tender.bids.map((bid, i) => (
                <tr key={i}>
                  <td>{bid.vendorName}</td>
                  <td className="num">₹{(bid.bidAmount / 100).toLocaleString("en-IN")}</td>
                  <td className="num">{bid.technicalScore ?? "—"}</td>
                  <td className="num">{bid.financialScore ?? "—"}</td>
                  <td><StatusPill status={bid.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
