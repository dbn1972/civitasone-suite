import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getProcurementIndentById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_po: "Converted to PO",
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

export default async function IndentDetailPage({ params }: { params: { id: string } }) {
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

  return (
    <>
      <PageHeader
        title={indent.indentNo}
        subtitle={`${indent.department} · ${indent.requestedBy}`}
        back="/procurement/indents"
        actions={
          <>
            <StatusPill status={indent.status} label={STATUS_LABELS[indent.status] ?? indent.status} />
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
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
            <span>{formatMoney(indent.estimatedAmount)}</span>
          </div>
          <div className="field">
            <span className="label">Request Date</span>
            <span>{formatIndianDate(indent.requestDate)}</span>
          </div>
          <div className="field">
            <span className="label">Required By</span>
            <span>{indent.requiredByDate ? formatIndianDate(indent.requiredByDate) : "—"}</span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <StatusPill status={indent.status} label={STATUS_LABELS[indent.status] ?? indent.status} />
          </div>
        </div>
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
