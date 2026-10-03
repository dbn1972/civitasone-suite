"use client";

/**
 * GAP-HR-TRAVEL-01: approve/reject routes existed with no approver-facing
 * UI at all -- the list was always self-scoped, so there was no queue to
 * act on in the first place (see TravelApprovalsTable.tsx + the new
 * `?scope=team` GET). Mirrors hr/advances/ApproveAdvanceButton.tsx and
 * hr/overtime/OvertimeActions.tsx's pattern. The backend's reason field
 * stays optional (unchanged contract, z.string().max(500).optional());
 * the dialog below requires one anyway as a UI-level diligence nudge --
 * ConfirmDialog's reason textarea only renders at all when requireReason
 * is set (there is no "optional but visible" mode in its API), and asking
 * an approver to explain a rejection is reasonable practice regardless of
 * what the schema strictly demands.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export function TravelApprovalActions({ id }: { id: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const formError = useFormError("travel request decision");
  const [error, setError] = useState<string | undefined>(undefined);

  async function decide(action: "approve" | "reject", reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/travel-requests/${id}/${action}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Button size="sm" variant="primary" onClick={() => { setDialog("approve"); setError(undefined); }}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" onClick={() => { setDialog("reject"); setError(undefined); }}>
        Reject
      </Button>

      <ConfirmDialog
        open={dialog === "approve"}
        title="Approve this travel request?"
        description="The employee will be notified their travel is approved."
        confirmLabel="Approve"
        busy={busy}
        errorMessage={error}
        onConfirm={() => decide("approve")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "reject"}
        title="Reject this travel request?"
        description="The employee will be notified, along with the reason below if you provide one."
        confirmLabel="Reject"
        danger
        requireReason
        reasonLabel="Reason for rejection"
        maxReasonLength={500}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => decide("reject", reason)}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
