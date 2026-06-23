"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DispatchPOActions({ poId, canDispatch }: { poId: string; canDispatch: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/pos/${poId}/dispatch`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "Dispatched from web UI" }),
      });
      const text = await res.text();
      if (!res.ok) {
        setMessage(text || `Dispatch failed (${res.status})`);
        return;
      }
      setMessage("PO dispatched to vendor.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void dispatch()}>
        {busy ? "Dispatching…" : "Dispatch to vendor"}
      </button>
      {message ? <span style={{ fontSize: "0.8rem", color: message.includes("failed") ? "#b91c1c" : "#047857" }}>{message}</span> : null}
    </div>
  );
}
