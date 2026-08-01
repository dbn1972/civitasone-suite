"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import type { RefundRecord } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function RefundDecideForm({ refundId, refund }: { refundId: string; refund: RefundRecord | null }) {
  const router = useRouter();
  const [pendingApprove, setPendingApprove] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const shortId = refundId.slice(0, 8);
  // Fail closed: never let a checker approve/reject a refund whose amount,
  // receipt and reason we could not load and show them (CRITICAL-1).
  const canDecide = refund !== null;

  function startDecide(approve: boolean) {
    if (!canDecide) return;
    setPendingApprove(approve);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitDecide(reason?: string) {
    if (pendingApprove === null || !canDecide) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>(`v1/revenue/refunds/${refundId}/decide`, {
        method: "PATCH",
        body: JSON.stringify({
          approve: pendingApprove,
          reason: reason?.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        `Decision submitted (${pendingApprove ? "approve" : "reject"}${res.id ? `, id ${res.id}` : ""}). It is` +
          " processed asynchronously; the server rejects it if you are the same officer who raised the refund.",
      );
      setPendingApprove(null);
      router.refresh();
    } catch (err) {
      setTone("bad");
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!canDecide && (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
          Approve/Reject are disabled until the refund record loads successfully.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn primary"
          style={{ minHeight: 44, minWidth: 120 }}
          aria-label={`Approve refund ${shortId}`}
          disabled={!canDecide}
          onClick={() => startDecide(true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn danger"
          style={{ minHeight: 44, minWidth: 120 }}
          aria-label={`Reject refund ${shortId}`}
          disabled={!canDecide}
          onClick={() => startDecide(false)}
        >
          Reject
        </button>
      </div>

      {message && (
        <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content" }}>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={pendingApprove ? "Approve this refund?" : "Reject this refund?"}
        confirmLabel={pendingApprove ? "Approve refund" : "Reject refund"}
        danger={pendingApprove === false}
        requireReason={pendingApprove === false}
        reasonLabel={pendingApprove === false ? "Reason for rejection" : "Reason (optional)"}
        busy={busy}
        errorMessage={dialogError}
        description={
          refund ? (
            <>
              {pendingApprove ? "Approving" : "Rejecting"} a refund of <strong>{formatMoney(refund.amountMinor)}</strong>{" "}
              against receipt <strong className="mono">{refund.receiptId.slice(0, 8)}</strong> — reason on file:{" "}
              <em>&ldquo;{refund.reason || "—"}&rdquo;</em>. This is a money-out decision — the deciding officer
              must be different from the officer who raised the refund; the server rejects same-user maker-checker
              decisions.
            </>
          ) : (
            "Refund details are unavailable."
          )
        }
        onConfirm={(reason) => void submitDecide(reason)}
        onCancel={() => {
          if (!busy) {
            setConfirmOpen(false);
            setPendingApprove(null);
            setDialogError(undefined);
          }
        }}
      />
    </div>
  );
}
