"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, EmptyState } from "@/app/_components/ds";
import { StatusPill } from "@/app/_components/ds/StatusPill";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

/**
 * GAP-REVENUE-ADJUSTMENTS-01: a balance-transfer adjustment is now maker-checker.
 * This is the checker's queue — pending transfers awaiting a distinct officer's
 * approval. Approve/Reject PATCH /v1/revenue/adjustments/:id/decide.
 *
 * Gating mirrors the refund decide screen: the officer who RAISED a transfer may
 * not decide it (separation of duties). We fail OPEN only when the current user
 * id is unknown (so a legitimate checker is never locked out by a missing sub);
 * the server is the authority and rejects a same-user decision regardless.
 */
export type PendingAdjustment = {
  id: string;
  createdAt: string;
  fromDemandId: string;
  toDemandId: string;
  amountMinor: string;
  reason: string;
  status: string;
  makerUserId: string;
};

export function AdjustmentApprovalQueue({
  pending,
  demandFyById,
  currentUserId,
}: {
  pending: PendingAdjustment[];
  demandFyById: Record<string, string>;
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<{ row: PendingAdjustment; approve: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());

  const fy = (id: string) => demandFyById[id] ?? `${id.slice(0, 8)}…`;

  function startDecide(row: PendingAdjustment, approve: boolean) {
    setDeciding({ row, approve });
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitDecide(reason?: string) {
    if (!deciding) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson(`v1/revenue/adjustments/${deciding.row.id}/decide`, {
        method: "PATCH",
        body: JSON.stringify({ approve: deciding.approve, reason: reason?.trim() || undefined }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        `Decision submitted (${deciding.approve ? "approve" : "reject"}). It is processed asynchronously; the server` +
          " rejects it if you are the same officer who requested the transfer.",
      );
      setDecidedIds((prev) => new Set(prev).add(deciding.row.id));
      setDeciding(null);
      router.refresh();
    } catch (err) {
      setTone("bad");
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const visible = pending.filter((p) => !decidedIds.has(p.id));

  const banner = message ? (
    <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content", marginBottom: 12 }}>
      {message}
    </p>
  ) : null;

  if (visible.length === 0) {
    return (
      <>
        {banner}
        <EmptyState
          icon="✅"
          title="No transfers awaiting approval"
          message="Pending balance transfers for this tenant will appear here for a distinct officer to approve or reject."
        />
      </>
    );
  }

  return (
    <>
      {banner}

      <div style={{ display: "grid", gap: 10 }}>
        {visible.map((row) => {
          const shortId = row.id.slice(0, 8);
          // Fail OPEN only when the id is unknown; server still enforces.
          const isMaker = !!currentUserId && !!row.makerUserId && currentUserId === row.makerUserId;
          return (
            <div
              key={row.id}
              className="card"
              style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: 12 }}
            >
              <div style={{ display: "grid", gap: 2, fontSize: 13.5 }}>
                <div style={{ fontWeight: 600 }}>
                  {formatMoney(row.amountMinor)} — FY {fy(row.fromDemandId)} → FY {fy(row.toDemandId)}
                </div>
                <div style={{ color: "var(--ink2)", fontSize: 12.5 }}>
                  {row.createdAt ? formatIndianDate(row.createdAt) : "—"} · {row.reason || "—"}
                </div>
                <StatusPill status={row.status} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {isMaker && (
                  <span role="status" style={{ fontSize: 12.5, color: "var(--ink2)" }}>
                    You requested this transfer; a different officer must decide.
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  aria-label={`Approve transfer ${shortId}`}
                  title={isMaker ? "You requested this transfer; a different officer must decide." : undefined}
                  disabled={isMaker}
                  onClick={() => startDecide(row, true)}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  aria-label={`Reject transfer ${shortId}`}
                  title={isMaker ? "You requested this transfer; a different officer must decide." : undefined}
                  disabled={isMaker}
                  onClick={() => startDecide(row, false)}
                >
                  Reject
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={deciding?.approve ? "Approve this transfer?" : "Reject this transfer?"}
        confirmLabel={deciding?.approve ? "Approve transfer" : "Reject transfer"}
        danger={deciding ? !deciding.approve : false}
        requireReason={deciding ? !deciding.approve : false}
        reasonLabel={deciding && !deciding.approve ? "Reason for rejection" : "Reason (optional)"}
        busy={busy}
        errorMessage={dialogError}
        description={
          deciding ? (
            <>
              {deciding.approve ? "Approving" : "Rejecting"} a transfer of{" "}
              <strong>{formatMoney(deciding.row.amountMinor)}</strong> from FY{" "}
              <strong>{fy(deciding.row.fromDemandId)}</strong> to FY <strong>{fy(deciding.row.toDemandId)}</strong>.
              {deciding.approve ? " On approval the balance moves between the two demands." : ""} The deciding officer
              must be different from the officer who requested it — the server rejects same-user maker-checker decisions.
            </>
          ) : null
        }
        onConfirm={(reason) => void submitDecide(reason)}
        onCancel={() => {
          if (!busy) {
            setConfirmOpen(false);
            setDeciding(null);
            setDialogError(undefined);
          }
        }}
      />
    </>
  );
}
