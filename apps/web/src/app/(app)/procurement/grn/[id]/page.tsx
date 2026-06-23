import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { getProcurementGRNById } from "../../../../_data/loaders";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  received: "Received",
  quality_check: "Quality Check",
  accepted: "Accepted",
  partially_rejected: "Partially Rejected",
  rejected: "Rejected",
};

export default async function GRNDetailPage({ params }: { params: { id: string } }) {
  const { data: grn, source } = await getProcurementGRNById(params.id);

  if (!grn) {
    return (
      <>
        <PageHeader title="Goods Receipt Note" back="/procurement/grn" />
        <EmptyState icon="📦" title="GRN not found" message="This GRN may have been removed or the ID is invalid." />
      </>
    );
  }

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
              label={grn.threeWayMatch ? "Three-way match ✓" : "Three-way mismatch"}
            />
            <StatusPill status={grn.status} label={STATUS_LABELS[grn.status] ?? grn.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
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
            <span>{grn.receivedDate}</span>
          </div>
          <div className="field">
            <span className="label">Three-way match</span>
            <span style={{ color: grn.threeWayMatch ? "#16a34a" : "#b91c1c", fontWeight: 600 }}>
              {grn.threeWayMatch ? "Matched (PO · receipt · inspection)" : "Not matched"}
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
              <span>{grn.inspection.inspectionDate}</span>
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

      {grn.items.length > 0 && (
        <Card title="Received items">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item code</th>
                <th>PO item ref</th>
                <th className="num">Ordered</th>
                <th className="num">Received</th>
                <th className="num">Accepted</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {grn.items.map((item, i) => (
                <tr key={item.id ?? i}>
                  <td><span className="mono">{item.itemCode}</span></td>
                  <td><span className="mono">{item.poItemRef}</span></td>
                  <td className="num">{item.orderedQty}</td>
                  <td className="num">{item.receivedQty}</td>
                  <td className="num" style={{ color: item.acceptedQty >= item.orderedQty ? "#16a34a" : "#d97706", fontWeight: 500 }}>
                    {item.acceptedQty}
                  </td>
                  <td>{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
