import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getProcurementAnnualPlanById } from "../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";
import { formatIndianDateTime } from "@/lib/formatters";
import { fyLabel } from "@/lib/financialYear";
import { PLAN_STATUS_LABELS, methodLabel } from "@/lib/procurementLabels";
import { PlanLifecycleActions } from "./PlanLifecycleActions";

// L1/L2 fix (see _data/loaders.ts getProcurementAnnualPlanById comment): this
// route did not exist at all before, even though the plans list page has
// always linked to it and the backend has always supported it.
//
// GAP-PROCUREMENT-PLANNING-DETAIL-02/03/05: adds the budget line / category /
// package / tender-link columns the loader already returns, an approval-history
// card (submitted/approved by+at, remarks, rejection reason), paise-exact
// formatMoney with a BigInt reconciliation of the line sum against the stored
// total, and removes the duplicate StatusPill (header only).

type LineRow = Record<string, unknown> & {
  id: string;
  itemCode: string;
  description: string;
  category: string;
  budgetLine: string;
  packageGroup: string;
  aggregatedQty: string;
  uom: string;
  method: string;
  estimatedValueMinor: string;
  tenderId: string | null;
  timelineQuarter: string;
};

const LINE_COLUMNS: { key: keyof LineRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
  { key: "itemCode", label: "Item code" },
  { key: "description", label: "Description" },
  { key: "category", label: "Category" },
  { key: "budgetLine", label: "Budget line" },
  { key: "packageGroup", label: "Package" },
  { key: "aggregatedQty", label: "Qty", align: "right" },
  { key: "uom", label: "UoM" },
  { key: "method", label: "Method" },
  { key: "estimatedValueMinor", label: "Est. value", align: "right", cellType: "amount" },
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
    id: line.id,
    itemCode: line.itemCode,
    description: line.description,
    category: line.procurementCategory,
    budgetLine: line.budgetLine ?? "—",
    packageGroup: line.packageGroup ?? "—",
    aggregatedQty: String(line.aggregatedQty),
    uom: line.uom,
    method: methodLabel(line.procurementMethod),
    estimatedValueMinor: line.estimatedValueMinor,
    tenderId: line.tenderId,
    timelineQuarter: line.timelineQuarter ?? "—",
  }));

  // GAP-PROCUREMENT-PLANNING-DETAIL-05: reconcile the stored total against the
  // sum of the lines, in BigInt (never float on paise). A mismatch is a data
  // integrity signal worth surfacing, not hiding.
  const lineSumMinor = plan.lines.reduce((s, l) => {
    try { return s + BigInt(l.estimatedValueMinor); } catch { return s; }
  }, 0n);
  let totalMinor: bigint | null = null;
  try { totalMinor = BigInt(plan.totalEstimatedMinor); } catch { totalMinor = null; }
  const totalsMismatch = totalMinor !== null && totalMinor !== lineSumMinor;

  const approvalHistory: { label: string; value: string }[] = [];
  if (plan.submittedBy) approvalHistory.push({ label: "Submitted by", value: plan.submittedBy });
  if (plan.submittedAt) approvalHistory.push({ label: "Submitted at", value: formatIndianDateTime(plan.submittedAt) });
  if (plan.approvedBy) approvalHistory.push({ label: "Approved by", value: plan.approvedBy });
  if (plan.approvedAt) approvalHistory.push({ label: "Approved at", value: formatIndianDateTime(plan.approvedAt) });

  return (
    <>
      <PageHeader
        title={plan.title}
        subtitle={`${fyLabel(plan.planYear)} · ${plan.department}`}
        back="/procurement/planning"
        actions={
          <>
            <StatusPill status={plan.status} label={PLAN_STATUS_LABELS[plan.status] ?? plan.status} />
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
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(plan.totalEstimatedMinor)}</span>
          </div>
          {totalsMismatch ? (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label" style={{ color: "var(--bad)" }}>Totals mismatch</span>
              <span style={{ color: "var(--bad)" }}>
                Stored total {formatMoney(plan.totalEstimatedMinor)} does not equal the sum of the lines ({formatMoney(lineSumMinor.toString())}).
              </span>
            </div>
          ) : null}
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

      {approvalHistory.length > 0 ? (
        <Card title="Approval history" padding>
          <div className="fields">
            {approvalHistory.map((h) => (
              <div className="field" key={h.label}>
                <span className="label">{h.label}</span>
                <span className="mono">{h.value}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <PlanLifecycleActions planId={plan.id} status={plan.status} submittedBy={plan.submittedBy} />

      {plan.lines.length > 0 && (
        <Card title="Plan lines">
          <DataTable<LineRow>
            columns={LINE_COLUMNS}
            rows={lineRows}
            rowLinkKey="tenderId" rowLinkPrefix="/procurement/tenders/"
            pageSize={50}
          />
        </Card>
      )}
    </>
  );
}
