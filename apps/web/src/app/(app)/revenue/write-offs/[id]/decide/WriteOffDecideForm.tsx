"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function WriteOffDecideForm({ writeOffId }: { writeOffId: string }) {
  const router = useRouter();
  const [pendingApprove, setPendingApprove] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const shortId = writeOffId.slice(0, 8);

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
      const res = await browserJson<AcceptedResponse>(`v1/revenue/write-offs/${writeOffId}/decide`, {
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
          " processed asynchronously; the server rejects it if you are the same officer who raised the write-off.",
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
          aria-label={`Approve write-off ${shortId}`}
          onClick={() => startDecide(true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn ghost"
          style={{ minHeight: 44 }}
          aria-label={`Reject write-off ${shortId}`}
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
        title={pendingApprove ? "Approve this write-off?" : "Reject this write-off?"}
        confirmLabel={pendingApprove ? "Approve write-off" : "Reject write-off"}
        danger={pendingApprove === false}
        reasonLabel="Reason (optional)"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            {pendingApprove ? "Approving" : "Rejecting"} write-off <strong className="mono">{shortId}</strong>. This
            permanently reduces the demand balance once approved — the deciding officer must be different from the
            officer who raised the write-off; the server rejects same-user maker-checker decisions.
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
