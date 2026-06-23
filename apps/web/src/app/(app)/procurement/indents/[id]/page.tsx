import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { getProcurementIndentById } from "../../../../_data/loaders";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_po: "Converted to PO",
};

export default async function IndentDetailPage({ params }: { params: { id: string } }) {
  const { data: indent, source } = await getProcurementIndentById(params.id);

  if (!indent) {
    return (
      <>
        <PageHeader title="Indent Detail" back="/procurement/indents" />
        <EmptyState icon="📋" title="Indent not found" message="This indent may have been removed or the ID is invalid." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={indent.indentNo}
        subtitle={`${indent.department} · ${indent.requestedBy}`}
        back="/procurement/indents"
        actions={
          <>
            <StatusPill status={indent.status} label={STATUS_LABELS[indent.status] ?? indent.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <Card title="Indent details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Indent No</span>
            <span className="mono">{indent.indentNo}</span>
          </div>
          <div className="field">
            <span className="label">Department</span>
            <span>{indent.department}</span>
          </div>
          <div className="field">
            <span className="label">Requested By</span>
            <span>{indent.requestedBy}</span>
          </div>
          <div className="field">
            <span className="label">Est. Amount</span>
            <span>₹{(indent.estimatedAmount / 100).toLocaleString("en-IN")}</span>
          </div>
          <div className="field">
            <span className="label">Request Date</span>
            <span>{indent.requestDate}</span>
          </div>
          <div className="field">
            <span className="label">Required By</span>
            <span>{indent.requiredByDate ?? "—"}</span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <StatusPill status={indent.status} label={STATUS_LABELS[indent.status] ?? indent.status} />
          </div>
        </div>
      </Card>

      {indent.lineItems.length > 0 && (
        <Card title="Line items">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Item Name</th>
                <th className="num">Qty</th>
                <th>Unit</th>
                <th className="num">Est. Unit Price</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {indent.lineItems.map((item, i) => (
                <tr key={i}>
                  <td><span className="mono">{item.itemCode}</span></td>
                  <td>{item.itemName}</td>
                  <td className="num">{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td className="num">₹{(item.estimatedUnitPrice / 100).toLocaleString("en-IN")}</td>
                  <td className="num">₹{(item.totalPrice / 100).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {indent.approvalTrail.length > 0 && (
        <Card title="Approval trail" padding>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {indent.approvalTrail.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <div style={{ marginTop: "6px", width: "8px", height: "8px", borderRadius: "50%", background: "#818cf8", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "#1e293b" }}>
                    {step.actor} — <span style={{ fontWeight: 400, color: "#64748b" }}>{step.action}</span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{step.timestamp}</div>
                  {step.remarks && <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "2px" }}>{step.remarks}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
