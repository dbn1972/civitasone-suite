"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

interface DprActionsProps {
  /** The project the DPR belongs to (path segment for the transition route). */
  projectId: string;
  /** The DPR id (path segment). */
  dprId: string;
  /** The DPR number, shown in the confirm recap. */
  dprNo: string;
  /** The DPR's current status (normalized backend value). */
  status: string;
}

type Action = "review" | "approve" | "return";

const ACTION_LABEL: Record<Action, string> = {
  review: "Start review",
  approve: "Approve",
  return: "Return for revision",
};

// GAP-PROJECTS-DPR-TRACKING-01: the valid transitions mirror the server's DPR
// status machine exactly (submitted → under_review → approved | revision):
//   submitted    → Start review
//   under_review → Approve | Return for revision
// Any other status (approved, revision) is terminal → no action offered.
function actionsFor(status: string): Action[] {
  if (status === "submitted") return ["review"];
  if (status === "under_review") return ["approve", "return"];
  return [];
}

export function DprActions({ projectId, dprId, dprNo, status }: DprActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState<string | null>(null);
  const formError = useFormError("DPR");

  const available = actionsFor(status);
  if (available.length === 0) return null;

  async function handleConfirm(action: Action, reason?: string) {
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/projects/${projectId}/dpr/${dprId}/transition`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
        },
      );
      if (!res.ok) {
        setErrorMessage((await formError.fromResponse(res, "save")).message);
        setBusy(false);
        return;
      }
      setBusy(false);
      setOpen(null);
      setSuccess(
        action === "approve"
          ? `DPR ${dprNo} approved.`
          : action === "return"
            ? `DPR ${dprNo} returned for revision.`
            : `DPR ${dprNo} is now under review.`,
      );
      router.refresh();
    } catch (caught) {
      setErrorMessage(formError.fromException("save", caught).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {available.map((action) => (
        <Button
          key={action}
          variant={action === "return" ? "secondary" : "primary"}
          style={{ minHeight: 36, fontSize: "0.8125rem" }}
          onClick={(e) => {
            // The row is a clickable link to the project; don't navigate when
            // the user is reaching for an action control.
            e.stopPropagation();
            setErrorMessage(undefined);
            setOpen(action);
          }}
        >
          {ACTION_LABEL[action]}
        </Button>
      ))}

      {success && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", margin: 0 }}>
          {success}
        </p>
      )}

      {open && (
        <ConfirmDialog
          open
          title={`${ACTION_LABEL[open]} — DPR ${dprNo}`}
          description={
            open === "approve" ? (
              <>This will approve DPR <strong>{dprNo}</strong>. This cannot be undone.</>
            ) : open === "return" ? (
              <>This will return DPR <strong>{dprNo}</strong> to the submitter for revision. Give the revision instruction below.</>
            ) : (
              <>This will mark DPR <strong>{dprNo}</strong> as under review.</>
            )
          }
          confirmLabel={ACTION_LABEL[open]}
          // GAP-PROJECTS-DPR-TRACKING-01: a return MUST carry a reason (the
          // revision instruction the submitter reads; the server also 400s a
          // reasonless return). Review/approve record an optional audit note.
          requireReason={open === "return"}
          reasonLabel={open === "return" ? "Revision instruction (recorded in the audit trail)" : "Reason (optional, recorded in the audit trail)"}
          busy={busy}
          errorMessage={errorMessage}
          onConfirm={(reason) => void handleConfirm(open, reason)}
          onCancel={() => {
            if (!busy) setOpen(null);
          }}
        />
      )}
    </div>
  );
}
