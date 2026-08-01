"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function RefundDecideForm({ refundId }: { refundId: string }) {
  const router = useRouter();
  const [pendingApprove, setPendingApprove] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const shortId = refundId.slice(0, 8);

  function startDecide(approve: boolean) {
    setPendingApprove(approve);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitDecide(reason?: string) {
    if (pendingApprove === null) return;
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn primary"
          style={{ minHeight: 44 }}
          aria-label={`Approve refund ${shortId}`}
          onClick={() => startDecide(true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn ghost"
          style={{ minHeight: 44 }}
          aria-label={`Reject refund ${shortId}`}
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
        reasonLabel="Reason (optional)"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            {pendingApprove ? "Approving" : "Rejecting"} refund <strong className="mono">{shortId}</strong>. This is
            a money-out decision — the deciding officer must be different from the officer who raised the refund;
            the server rejects same-user maker-checker decisions.
          </>
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
