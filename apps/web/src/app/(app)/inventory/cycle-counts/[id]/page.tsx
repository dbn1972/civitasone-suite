import { PageHeader, Card, StatusPill, EmptyState, LoadErrorState } from "../../../../_components/ds";
import { getCycleCountById } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, getSessionUserId, INVENTORY_CYCLE_COUNT_APPROVE_ROLES } from "@/lib/auth/roleGuard";
import { CycleCountActions } from "./CycleCountActions";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending count",
  auto_posted: "Auto-posted",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

export default async function CycleCountDetailPage({ params }: { params: { id: string } }) {
  const result = await getCycleCountById(params.id);
  const { data: cycleCount } = result;

  // GAP-INVENTORY-CYCLE-COUNTS-DETAIL-01: an outage (5xx/timeout/403) must not
  // read as "not found" on an approval screen -- only a real 404 does.
  if (result.source === "error" && result.status !== 404) {
    return (
      <>
        <PageHeader title="Cycle Count" back="/inventory/list" />
        <LoadErrorState result={result} area="cycle count" backHref="/inventory/list" />
      </>
    );
  }

  if (!cycleCount) {
    return (
      <>
        <PageHeader title="Cycle Count" back="/inventory/list" />
        <EmptyState
          icon="🔢"
          title="Cycle count not found"
          message="This cycle count may have been removed or the ID is invalid."
        />
      </>
    );
  }

  // GAP-INVENTORY-CYCLE-COUNTS-DETAIL-02: only an approver role may approve/reject,
  // and never the user who recorded the count (maker != checker). The service
  // enforces both; this just stops offering a button that is guaranteed to 403.
  const isApprover = getSessionRoles().some((r) => INVENTORY_CYCLE_COUNT_APPROVE_ROLES.includes(r));
  const isMaker = Boolean(cycleCount.createdBy) && cycleCount.createdBy === getSessionUserId();
  const canDecide = cycleCount.status === "pending_approval" && isApprover && !isMaker;

  const varianceLabel = cycleCount.variance > 0 ? `+${cycleCount.variance}` : String(cycleCount.variance);
  const varianceColor = cycleCount.variance === 0 ? "#475569" : cycleCount.variance > 0 ? "#16a34a" : "#b91c1c";

  return (
    <>
      <PageHeader
        title="Cycle Count"
        subtitle={`Item ${cycleCount.itemId}`}
        back="/inventory/list"
        actions={
          <>
            <StatusPill status={cycleCount.status} label={STATUS_LABELS[cycleCount.status] ?? cycleCount.status} />
            {canDecide ? (
              <CycleCountActions cycleCountId={cycleCount.id} version={cycleCount.version} />
            ) : null}
          </>
        }
      />

      {cycleCount.status === "pending_approval" && isApprover && isMaker ? (
        <p role="note" style={{ fontSize: 13, color: "#92400e", margin: "0 0 12px" }}>
          You recorded this count, so a different approver must approve or reject it.
        </p>
      ) : null}

      <Card title="Cycle count details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Item</span>
            <span className="mono">{cycleCount.itemId}</span>
          </div>
          <div className="field">
            <span className="label">Warehouse</span>
            <span className="mono">{cycleCount.warehouseId}</span>
          </div>
          <div className="field">
            <span className="label">System qty</span>
            <span>{cycleCount.systemQty}</span>
          </div>
          <div className="field">
            <span className="label">Physical qty</span>
            <span>{cycleCount.physicalQty}</span>
          </div>
          <div className="field">
            <span className="label">Variance</span>
            <span style={{ color: varianceColor, fontWeight: 600 }}>{varianceLabel}</span>
          </div>
          <div className="field">
            <span className="label">Absolute variance</span>
            <span>{cycleCount.absVariance}</span>
          </div>
          <div className="field">
            <span className="label">Auto-adjust threshold</span>
            <span>{cycleCount.autoAdjustThreshold}</span>
          </div>
          <div className="field">
            <span className="label">Reason code</span>
            <span>{cycleCount.reasonCode}</span>
          </div>
          <div className="field">
            <span className="label">Counted at</span>
            <span>{formatIndianDate(cycleCount.countedAt)}</span>
          </div>
          {cycleCount.status === "approved" ? (
            <div className="field">
              <span className="label">Approved</span>
              <span>
                {cycleCount.approvedBy ?? "—"}
                {cycleCount.approvedAt ? ` · ${formatIndianDate(cycleCount.approvedAt)}` : ""}
              </span>
            </div>
          ) : null}
          {cycleCount.status === "rejected" ? (
            <>
              <div className="field">
                <span className="label">Rejected</span>
                <span>
                  {cycleCount.rejectedBy ?? "—"}
                  {cycleCount.rejectedAt ? ` · ${formatIndianDate(cycleCount.rejectedAt)}` : ""}
                </span>
              </div>
              {cycleCount.rejectionReason ? (
                <div className="field">
                  <span className="label">Rejection reason</span>
                  <span>{cycleCount.rejectionReason}</span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </Card>
    </>
  );
}
