import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { getCycleCountById } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { CycleCountActions } from "./CycleCountActions";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending count",
  auto_posted: "Auto-posted",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

export default async function CycleCountDetailPage({ params }: { params: { id: string } }) {
  const { data: cycleCount, source } = await getCycleCountById(params.id);

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
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            {cycleCount.status === "pending_approval" ? (
              <CycleCountActions cycleCountId={cycleCount.id} version={cycleCount.version} />
            ) : null}
          </>
        }
      />

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
