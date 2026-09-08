"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// DOM-002 — the real, second-actor inspection step. Deliberately does NOT
// collect or send an inspector id: PATCH /grns/:id/accept and
// /grns/:id/reject derive the inspector from the CALLER's own authenticated
// session (ctx.actorId server-side), so this form only ever expresses "I,
// the current logged-in user, accept/reject this GRN". If the current user
// is the same person who created the GRN, the server rejects with 403
// SOD_VIOLATION — this page does not try to pre-empt that; it just surfaces
// whatever the server says.
export function InspectGrnForm({ grnId }: { grnId: string }) {
  const router = useRouter();
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "accepting" | "rejecting" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(action: "accept" | "reject") {
    if (action === "reject" && !reason.trim()) {
      setStatus("error");
      setMessage("A reason is required to reject a GRN.");
      return;
    }
    setStatus(action === "accept" ? "accepting" : "rejecting");
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/procurement/grns/${grnId}/${action}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "accept" ? { remarks: remarks.trim() || undefined } : { reason: reason.trim() }),
      });
      const text = await res.text();
      if (!res.ok) {
        let human = `Could not ${action} this GRN (${res.status}).`;
        try {
          const parsed = JSON.parse(text) as { code?: string; message?: string };
          if (parsed.code === "SOD_VIOLATION") {
            human = "You created this GRN, so you cannot also inspect it — a different officer must accept or reject it.";
          } else if (parsed.message) {
            human = parsed.message;
          }
        } catch { /* ignore */ }
        setStatus("error");
        setMessage(human);
        return;
      }
      setStatus("done");
      setMessage(action === "accept" ? "GRN accepted — three-way match computed." : "GRN rejected.");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  const busy = status === "accepting" || status === "rejecting";

  return (
    <div className="card pad">
      <p style={{ marginBottom: 12, fontSize: "0.875rem", color: "var(--muted, #6b7280)" }}>
        Inspect the received items and record a decision. You must be a different officer from
        whoever created this GRN.
      </p>
      <div className="fields">
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Acceptance remarks (optional)</span>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} style={{ minHeight: 44 }} />
        </label>
        <label className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <span className="label">Rejection reason (required to reject)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 44 }} />
        </label>
      </div>
      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "#b91c1c" : "#047857" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="button" className="btn primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => void submit("accept")}>
          {status === "accepting" ? "Accepting…" : "Accept"}
        </button>
        <button type="button" className="btn ghost" style={{ minHeight: 44 }} disabled={busy} onClick={() => void submit("reject")}>
          {status === "rejecting" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}
