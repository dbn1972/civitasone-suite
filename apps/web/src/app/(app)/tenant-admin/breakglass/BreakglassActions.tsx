"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export function BreakglassActions({ id, requester }: { id: string; requester?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const formError = useFormError("break-glass session");

  async function close(reason?: string) {
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/identity/break-glass/${id}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="danger" size="sm" disabled={busy} onClick={() => { setError(undefined); setOpen(true); }}>
        {busy ? "Closing…" : "Close session"}
      </Button>
      <ConfirmDialog
        open={open}
        title="Close this break-glass session?"
        description={
          <>
            This immediately revokes the emergency access{requester ? <> granted to <b>{requester}</b></> : null} and
            records the closure in the audit log. This cannot be undone.
          </>
        }
        confirmLabel="Close session"
        danger
        requireReason
        reasonLabel="Reason for closing (recorded in the audit log)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void close(reason)}
        onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
      />
    </>
  );
}
