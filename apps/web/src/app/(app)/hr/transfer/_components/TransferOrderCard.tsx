"use client";
/**
 * TransferOrderCard — Sprint 13 / Lifecycle Phase 1
 * Shows: from-office, to-office, joining date, order no., order date (Indian format).
 * Status chip: Initiated/HOD Approved/Admin Approved/Relieved/Joined.
 * Action buttons per stage. Horizontal progress timeline.
 */
import { useState } from "react";
import { StatusPill, ConfirmDialog } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useToast } from "@/app/_components/ds/Toast";

export type TransferRow = {
  id: string;
  employee?: string;
  employeeId?: string;
  fromOffice?: string;
  fromDeptId?: string;
  toOffice?: string;
  toDeptId?: string;
  orderNo?: string | null;
  orderDate?: string | null;
  effectiveDate?: string | null;
  relievedDate?: string | null;
  joinedDate?: string | null;
  transferDate?: string | null;
  status: string;
  department?: string;
  createdAt?: string;
} & Record<string, unknown>;

const STAGE_LABEL: Record<string, string> = {
  pending: "Initiated",
  initiated: "Initiated",
  hod_approved: "HOD Approved",
  admin_approved: "Admin Approved",
  order_issued: "Order Issued",
  approved: "Order Issued",
  relieved: "Relieved",
  joined: "Joined",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PIPELINE: Array<{ key: string; label: string }> = [
  { key: "pending",        label: "Initiated"      },
  { key: "hod_approved",   label: "HOD Approved"   },
  { key: "admin_approved", label: "Admin Approved" },
  { key: "order_issued",   label: "Order Issued"   },
  { key: "relieved",       label: "Relieved"       },
  { key: "joined",         label: "Joined"         },
];

function stageIndex(status: string): number {
  const map: Record<string, number> = {
    pending: 0, initiated: 0,
    hod_approved: 1,
    admin_approved: 2,
    order_issued: 3, approved: 3,
    relieved: 4,
    joined: 5, completed: 5,
  };
  return map[status] ?? 0;
}

interface Props {
  transfer: TransferRow;
  onAction?: () => void;
}

type PendingStage = {
  path: string;
  body: Record<string, string>;
  label: string;
  title: string;
  description: string;
};

export function TransferOrderCard({ transfer, onAction }: Props) {
  const { toast } = useToast();
  const [acting, setActing] = useState(false);
  const [pending, setPending] = useState<PendingStage | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const statusLabel = STAGE_LABEL[transfer.status] ?? transfer.status;
  const currentIdx = stageIndex(transfer.status);
  const today = new Date().toISOString().split("T")[0] ?? "";
  const isClosed = ["joined", "completed", "cancelled"].includes(transfer.status);
  const isCancelled = transfer.status === "cancelled";
  const empLabel = transfer.employee ?? transfer.employeeId ?? "Unknown";

  const postAction = async (path: string, body: Record<string, string>) => {
    setActing(true);
    setDialogError(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/hrms/lifecycle/transfers/${transfer.id}/${path}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      toast.success("Transfer updated. Change will reflect shortly.");
      setPending(null);
      onAction?.();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(false);
    }
  };

  const fromLabel = transfer.fromOffice ?? transfer.fromDeptId ?? "—";
  const toLabel   = transfer.toOffice   ?? transfer.toDeptId   ?? "—";

  return (
    <div className="card" style={{ marginBottom: 0 }} aria-label={`Transfer order for ${empLabel}`}>
      <div className="card-h" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{empLabel}</h3>
          <p style={{ margin: "3px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {fromLabel} &rarr; {toLabel}
          </p>
        </div>
        <StatusPill status={transfer.status} label={statusLabel} />
      </div>

      <div className="pad" style={{ paddingTop: 4 }}>
        <div className="fields" style={{ marginTop: 8 }}>
          {transfer.orderNo != null && (
            <div className="fld">
              <span className="l">Order No.</span>
              <span className="v" style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>{transfer.orderNo}</span>
            </div>
          )}
          {transfer.orderDate && (
            <div className="fld">
              <span className="l">Order Date</span>
              <span className="v">{formatIndianDate(transfer.orderDate)}</span>
            </div>
          )}
          {(transfer.effectiveDate ?? transfer.transferDate) && (
            <div className="fld">
              <span className="l">Effective / Joining Date</span>
              <span className="v">{formatIndianDate((transfer.effectiveDate ?? transfer.transferDate) as string)}</span>
            </div>
          )}
          {transfer.relievedDate && (
            <div className="fld">
              <span className="l">Relieved On</span>
              <span className="v">{formatIndianDate(transfer.relievedDate)}</span>
            </div>
          )}
          {transfer.joinedDate && (
            <div className="fld">
              <span className="l">Joined On</span>
              <span className="v">{formatIndianDate(transfer.joinedDate)}</span>
            </div>
          )}
        </div>

        {/* Stage progress timeline */}
        {isCancelled ? (
          <p style={{ margin: "16px 0 6px", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            This transfer order was cancelled before completing the pipeline below.
          </p>
        ) : (
        <div
          aria-label="Transfer status timeline"
          style={{ display: "flex", alignItems: "flex-start", margin: "16px 0 6px", overflowX: "auto", paddingBottom: 4 }}
        >
          {PIPELINE.map(({ key, label }, i) => {
            const done   = i < currentIdx;
            const active = i === currentIdx;
            const bg  = done ? "#16a34a" : active ? "#2563eb" : "var(--line, #e2e8f0)";
            const fg  = done || active ? "#fff" : "var(--ink3, #94a3b8)";
            const connBg = done ? "#16a34a" : "var(--line, #e2e8f0)";
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div
                    title={label}
                    style={{
                      width: 26, height: 26, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, background: bg, color: fg,
                    }}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <span style={{
                    fontSize: "0.625rem", marginTop: 3,
                    color: active ? "#2563eb" : done ? "#16a34a" : "var(--ink3)",
                    fontWeight: active ? 600 : 400,
                    whiteSpace: "nowrap", maxWidth: 56, textAlign: "center",
                  }}>
                    {label}
                  </span>
                </div>
                {i < PIPELINE.length - 1 && (
                  <div style={{ width: 20, height: 2, background: connBg, flexShrink: 0, margin: "0 2px", marginBottom: 16 }} />
                )}
              </div>
            );
          })}
        </div>
        )}

        {/* Action buttons per stage -- each is a real, hard-to-reverse
            lifecycle transition (an issued order number, an official
            relieving date, a join date), so each is gated by a
            ConfirmDialog naming the employee and the exact effective date
            rather than firing on a bare click. */}
        {!isClosed && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {(transfer.status === "pending" || transfer.status === "initiated") && (
              <button className="btn primary" style={{ fontSize: 13 }} disabled={acting}
                onClick={() => setPending({
                  path: "issue-order",
                  body: { orderNo: `TO-${transfer.id.slice(0, 8).toUpperCase()}`, orderDate: today },
                  label: "Issue Order",
                  title: "Issue the transfer order?",
                  description: `This issues a formal transfer order for ${empLabel} (${fromLabel} → ${toLabel}), dated ${today}. The order number cannot be un-issued once created.`,
                })}>
                {acting ? "Processing…" : "Issue Order"}
              </button>
            )}
            {(transfer.status === "order_issued" || transfer.status === "approved") && !transfer.relievedDate && (
              <button className="btn primary" style={{ fontSize: 13 }} disabled={acting}
                onClick={() => setPending({
                  path: "relieve",
                  body: { relievedDate: today },
                  label: "Mark Relieved",
                  title: "Mark this employee relieved?",
                  description: `This records ${empLabel} as relieved from ${fromLabel} effective ${today}, ending their tenure at the current post.`,
                })}>
                {acting ? "Processing…" : "Mark Relieved"}
              </button>
            )}
            {transfer.status === "relieved" && !transfer.joinedDate && (
              <button className="btn primary" style={{ fontSize: 13 }} disabled={acting}
                onClick={() => setPending({
                  path: "join",
                  body: { joinedDate: today },
                  label: "Mark Joined",
                  title: "Mark this employee joined?",
                  description: `This records ${empLabel} as joined at ${toLabel} effective ${today} and completes the transfer.`,
                })}>
                {acting ? "Processing…" : "Mark Joined"}
              </button>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? "Confirm"}
        description={pending?.description}
        confirmLabel={pending?.label ?? "Confirm"}
        busy={acting}
        errorMessage={dialogError}
        onConfirm={() => pending && void postAction(pending.path, pending.body)}
        onCancel={() => { if (!acting) { setPending(null); setDialogError(undefined); } }}
      />
    </div>
  );
}
