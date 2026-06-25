"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "../../../_components/ds";

export function BreakglassActions({ id, requester }: { id: string; requester?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function close(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/identity/break-glass/${id}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = text || `Request failed (${res.status})`;
        try {
          const j = JSON.parse(text) as { message?: string };
          if (j.message) msg = j.message;
        } catch { /* not json */ }
        throw new Error(msg);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close session. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn danger sm" disabled={busy} onClick={() => { setError(undefined); setOpen(true); }}>
        {busy ? "Closing…" : "Close session"}
      </button>
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
