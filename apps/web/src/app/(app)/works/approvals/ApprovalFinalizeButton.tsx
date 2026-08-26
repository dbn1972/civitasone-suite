"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast } from "@/app/_components/ds";

interface ApprovalFinalizeButtonProps {
  id: string;
  type: "aa" | "ts";
  status: string;
}

// Only offer Finalize for statuses the backend will actually accept. Other
// (intermediate / terminal) statuses hide the trigger to avoid a guaranteed
// error.
const FINALIZABLE_STATUSES = new Set(["draft", "submitted"]);
// Terminal states the *server* reports once the async finalize has been applied
// by the consumer. Derived from the prop every render (see `done` below).
const FINALIZED_STATUSES = new Set(["finalized", "approved", "published"]);

const TYPE_LABEL: Record<"aa" | "ts", string> = {
  aa: "Administrative Approval",
  ts: "Technical Sanction",
};

export function ApprovalFinalizeButton({
  id,
  type,
  status,
}: ApprovalFinalizeButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // True once the server has *accepted* the finalize request (HTTP 202). The
  // record is NOT finalized yet — a consumer applies it asynchronously — so we
  // must not claim it is done. We show a truthful "pending" state instead.
  const [submitted, setSubmitted] = useState(false);

  // Derived from the server-provided status on every render, so a refresh that
  // has picked up the applied change flips this to the real finalized state
  // (rather than trusting an optimistic local flag).
  const done = FINALIZED_STATUSES.has(status);
  const label = TYPE_LABEL[type];

  // Already finalized per the server — the honest terminal state.
  if (done) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 16px",
          borderRadius: 8,
          background: "#ecfdf3",
          color: "#166534",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        ✓ Finalized
      </span>
    );
  }

  // Request accepted (202) but not yet applied by the consumer — pending, not
  // done. Colour + icon + text (never colour alone) so the state is legible.
  if (submitted) {
    return (
      <span
        role="status"
        aria-live="polite"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 16px",
          borderRadius: 8,
          background: "#fffaeb",
          color: "#b45309",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        ⏳ Finalization pending
      </span>
    );
  }

  // Not in a finalizable state — hide entirely.
  if (!FINALIZABLE_STATUSES.has(status)) return null;

  async function handleFinalize() {
    if (busy) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch(
        `/api/proxy/v1/works/approvals/${type}/${id}/finalize`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(
          (data as { message?: string }).message ??
            `Finalize failed (${res.status})`,
        );
        return;
      }
      // HTTP 202 Accepted: the finalize is queued, not applied. Tell the truth
      // — show a pending state and refresh so the real, server-confirmed status
      // takes over once the consumer has processed it.
      setOpen(false);
      setSubmitted(true);
      toast.success(
        `${label} submitted for finalization. It will show as finalized once processed.`,
      );
      setTimeout(() => router.refresh(), 800);
    } catch {
      setErrorMessage("Network error — could not submit. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 20px",
          borderRadius: 8,
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        {type === "aa" ? "Finalize AA" : "Finalize TS"}
      </button>
      <ConfirmDialog
        open={open}
        title={
          type === "aa"
            ? "Finalize Administrative Approval"
            : "Finalize Technical Sanction"
        }
        description={`This finalizes ${label.toLowerCase()} ${id.slice(0, 8)}… and locks it for the next stage of the work. This action cannot be undone.`}
        confirmLabel="Finalize"
        danger
        busy={busy}
        errorMessage={errorMessage || undefined}
        onConfirm={handleFinalize}
        onCancel={() => {
          setOpen(false);
          setErrorMessage("");
        }}
      />
    </>
  );
}
