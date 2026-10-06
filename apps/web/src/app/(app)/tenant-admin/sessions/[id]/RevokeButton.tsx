"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-TENANT-ADMIN-SESSIONS-DETAIL-02: a real, audited "Revoke session" control
 * for the session detail page, replacing the disabled coming-soon placeholder.
 * Uses the same DELETE /api/proxy/identity/sessions/:id + ConfirmDialog
 * (requireReason) flow the list page uses; identity-service authorises and
 * audits the revoke server-side. On success it returns to the sessions list.
 * Hidden by the page for non-active sessions and for the admin's own session.
 */
export function RevokeButton({
  sessionId,
  who,
}: {
  sessionId: string;
  who: string;
}) {
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
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setOpen(false);
      router.push("/tenant-admin/sessions");
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="danger" disabled={busy} style={{ minHeight: 44, minWidth: 44 }} onClick={() => { setError(undefined); setOpen(true); }}>
        Revoke Session
      </Button>
      <ConfirmDialog
        open={open}
        title="Revoke this session?"
        description={
          <>
            This signs out <b>{who}</b> immediately. They will need to sign in again. This cannot be undone.
          </>
        }
        confirmLabel="Revoke session"
        danger
        requireReason
        reasonLabel="Reason (recorded in the audit log)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void revoke(reason)}
        onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
      />
    </>
  );
}
