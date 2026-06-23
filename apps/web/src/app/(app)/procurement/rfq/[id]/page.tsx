import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { getRFQById } from "../../../../_data/loaders";

export default async function RFQDetailPage({ params }: { params: { id: string } }) {
  const { data: rfq, source } = await getRFQById(params.id);

  if (!rfq) {
    return (
      <>
        <PageHeader title="RFQ Detail" back="/procurement/rfq" />
        <EmptyState icon="📝" title="RFQ not found" message="This RFQ may have been removed or the ID is invalid." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={rfq.rfqNo}
        subtitle={rfq.title}
        back="/procurement/rfq"
        actions={
          <>
            <StatusPill status={rfq.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
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
            <span className="mono">{rfq.indentRef ?? "—"}</span>
          </div>
          <div className="field">
            <span className="label">Closing Date</span>
            <span>{rfq.closingDate}</span>
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
              <span>{rfq.description}</span>
            </div>
          )}
        </div>
      </Card>

      {rfq.lineItems.length > 0 && (
        <Card title="Line items">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item Name</th>
                <th className="num">Qty</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {rfq.lineItems.map((item, i) => (
                <tr key={i}>
                  <td>{item.itemName}</td>
                  <td className="num">{item.quantity}</td>
                  <td>{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {rfq.responses.length > 0 && (
        <Card title="Vendor responses">
          <table className="tbl">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="num">Bid Amount</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rfq.responses.map((resp, i) => (
                <tr key={i}>
                  <td>{resp.vendorName}</td>
                  <td className="num">₹{(resp.totalAmount / 100).toLocaleString("en-IN")}</td>
                  <td>{resp.submittedAt}</td>
                  <td><StatusPill status={resp.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
