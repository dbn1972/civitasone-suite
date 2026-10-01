"use client";

/**
 * GAP-HR-OVERTIME-01: the page previously had no approve/reject control at
 * all -- PATCH .../approve|reject existed with no caller. Mirrors
 * hr/advances/ApproveAdvanceButton.tsx's pattern exactly. The backend now
 * also rejects the case where the deciding HR actor is the request's own
 * creator (server-enforced; this is UX only).
 *
 * Bug fix (caught after this file first shipped, before merge): the reject
 * dialog originally set maxReasonLength without requireReason --
 * ConfirmDialog's reason textarea only renders at all when requireReason
 * is set (there is no "optional but visible" mode in its API), so the
 * dialog's own description text ("...and the reason below") pointed at a
 * field that never appeared, and reject always sent reason: undefined.
 * Requiring one here is also a reasonable diligence nudge regardless --
 * the backend's own z.string().max(500).optional() stays unchanged.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export function OvertimeActions({ id }: { id: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const formError = useFormError("overtime decision");
  const [error, setError] = useState<string | undefined>(undefined);

  async function decide(action: "approve" | "reject", reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/overtime-requests/${id}/${action}`, {
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
    } catch {
      setError(formError.fromException("save").message);
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
        title="Approve this overtime request?"
        description="The employee will be notified. This is queued for payroll disbursement."
        confirmLabel="Approve"
        busy={busy}
        errorMessage={error}
        onConfirm={() => decide("approve")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "reject"}
        title="Reject this overtime request?"
        description="The employee will be notified of the rejection and the reason below."
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
