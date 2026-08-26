import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getProcurementAnnualPlanById } from "../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { PlanLifecycleActions } from "./PlanLifecycleActions";

// L1/L2 fix (see _data/loaders.ts getProcurementAnnualPlanById comment): this
// route did not exist at all before, even though the plans list page has
// always linked to it and the backend has always supported it.

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

function fmtAmount(minor: string | number): string {
  const v = typeof minor === "number" ? minor : parseInt(minor, 10);
  if (isNaN(v)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v / 100);
}

type LineRow = Record<string, unknown> & {
  itemCode: string;
  description: string;
  aggregatedQty: string;
  uom: string;
  procurementMethod: string;
  estimatedValueMinor: string;
  timelineQuarter: string;
};

const LINE_COLUMNS: { key: keyof LineRow; label: string; align?: "left" | "right" }[] = [
  { key: "itemCode", label: "Item code" },
  { key: "description", label: "Description" },
  { key: "aggregatedQty", label: "Qty", align: "right" },
  { key: "uom", label: "UoM" },
  { key: "procurementMethod", label: "Method" },
  { key: "estimatedValueMinor", label: "Est. value", align: "right" },
  { key: "timelineQuarter", label: "Quarter" },
];

export default async function AnnualPlanDetailPage({ params }: { params: { id: string } }) {
  const { data: plan, source } = await getProcurementAnnualPlanById(params.id);

  if (!plan) {
    // L3: distinguish "genuinely no such plan" from "couldn't reach the
    // server" — see indents/[id]/page.tsx for the same fix and rationale.
    return (
      <>
        <PageHeader title="Annual Procurement Plan" back="/procurement/planning" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "procurement plan" })} backHref="/procurement/planning" />
        ) : (
          <EmptyState icon="📋" title="Plan not found" message="This plan may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  const lineRows: LineRow[] = plan.lines.map((line) => ({
    itemCode: line.itemCode,
    description: line.description,
    aggregatedQty: String(line.aggregatedQty),
    uom: line.uom,
    procurementMethod: line.procurementMethod.replace(/_/g, " "),
    estimatedValueMinor: fmtAmount(line.estimatedValueMinor),
    timelineQuarter: line.timelineQuarter ?? "—",
  }));

  return (
    <>
      <PageHeader
        title={plan.title}
        subtitle={`FY ${plan.planYear}–${(plan.planYear + 1).toString().slice(2)} · ${plan.department}`}
        back="/procurement/planning"
        actions={
          <>
            <StatusPill status={plan.status} label={STATUS_LABELS[plan.status] ?? plan.status} />
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <Card title="Plan details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Plan No</span>
            <span className="mono">{plan.planNo}</span>
          </div>
          <div className="field">
            <span className="label">Department</span>
            <span>{plan.department}</span>
          </div>
          <div className="field">
            <span className="label">Total estimated</span>
            <span>{fmtAmount(plan.totalEstimatedMinor)}</span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <StatusPill status={plan.status} label={STATUS_LABELS[plan.status] ?? plan.status} />
          </div>
          {plan.notes ? (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Notes</span>
              <span>{plan.notes}</span>
            </div>
          ) : null}
          {plan.status === "rejected" && plan.rejectedReason ? (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Rejection reason</span>
              <span>{plan.rejectedReason}</span>
            </div>
          ) : null}
        </div>
      </Card>

      <PlanLifecycleActions planId={plan.id} status={plan.status} />

      {plan.lines.length > 0 && (
        <Card title="Plan lines">
          <DataTable<LineRow>
            columns={LINE_COLUMNS}
            rows={lineRows}
            pageSize={50}
          />
        </Card>
      )}
    </>
  );
}
