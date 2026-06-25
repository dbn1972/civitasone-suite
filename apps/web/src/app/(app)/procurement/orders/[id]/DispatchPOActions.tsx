"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

export function DispatchPOActions({ poId, canDispatch }: { poId: string; canDispatch: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");

  if (!canDispatch) {
    return (
      <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
        Approve via <a href="/procurement/approvals" style={{ color: "#4f46e5" }}>workflow inbox</a> before dispatch.
      </p>
    );
  }

  async function dispatch() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/pos/${poId}/dispatch`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "Dispatched from web UI" }),
      });
      const text = await res.text();
      if (!res.ok) {
        const msg = text || `Dispatch failed (${res.status})`;
        setError(msg);
        throw new Error(msg);
      }
      setOpen(false);
      setMessage("PO dispatched to vendor.");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setError(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      <button
        type="button"
        className="btn primary"
        style={{ minHeight: 44 }}
        onClick={() => { setError(undefined); setMessage(""); setOpen(true); }}
      >
        Dispatch to vendor
      </button>
      <span role="status" aria-live="polite" style={{ fontSize: "0.8rem", color: "#047857" }}>{message}</span>

      <ConfirmDialog
        open={open}
        title="Dispatch this PO to the vendor?"
        description="This issues the purchase order to the vendor and cannot be undone."
        confirmLabel="Dispatch"
        danger
        busy={busy}
        errorMessage={error}
        onConfirm={() => { void dispatch().catch(() => {}); }}
        onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
      />
    </div>
  );
}
