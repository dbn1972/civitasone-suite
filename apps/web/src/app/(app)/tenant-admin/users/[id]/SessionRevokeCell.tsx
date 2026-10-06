"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type Props = { sessionId: string; active: boolean };

/**
 * Per-session "Revoke" control.
 *
 * GAP-TENANT-ADMIN-USERS-DETAIL-02:
 *  - No DELETE fires until an admin confirms a reason in a ConfirmDialog
 *    (danger, requireReason), mirroring tenant-admin/sessions/SessionsTable.
 *    The reason is sent as a JSON {reason} body, which identity-service records
 *    in the session-revoked audit event.
 *  - On failure we show a clerk-safe message from useFormError, never the raw
 *    `await res.text()` server body that could leak internals.
 *  - A non-active row shows a disabled control.
 */
export function SessionRevokeCell({ sessionId, active }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const formError = useFormError("session");

  async function revoke(reason?: string) {
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/identity/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return <span style={{ fontSize: 12, color: "var(--mut)" }} aria-disabled="true">Revoke</span>;
  }

  return (
    <>
      <Button
        variant="ghost"
        style={{ fontSize: 12, padding: "2px 8px" }}
        disabled={busy}
        aria-busy={busy}
        aria-label="Revoke this session"
        onClick={() => { setError(undefined); setOpen(true); }}
      >
        Revoke
      </Button>
      <ConfirmDialog
        open={open}
        title="Revoke this session?"
        description="This signs the user out of this session immediately. They will need to sign in again. This cannot be undone."
        confirmLabel="Revoke session"
        danger
        requireReason
        minReasonLength={3}
        reasonLabel="Reason (recorded in the audit log)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void revoke(reason)}
        onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
      />
    </>
  );
}
