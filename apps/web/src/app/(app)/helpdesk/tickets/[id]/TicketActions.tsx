"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { ticketId: string };

export function TicketActions({ ticketId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"reply" | "assign" | "resolve" | null>(null);
  const [reply, setReply] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [resolveNote, setResolveNote] = useState("");

  async function request(method: string, path: string, body?: object) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Saved.");
      setMode(null);
      setReply("");
      setAssigneeId("");
      setResolveNote("");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setMode("reply")}>Reply</button>
      <button type="button" className="btn ghost" onClick={() => setMode("assign")}>Assign</button>
      <button type="button" className="btn ghost" onClick={() => setMode("resolve")}>Resolve</button>
      {mode === "reply" ? (
        <div className="card" style={{ marginTop: 16, gridColumn: "1 / -1" }}>
          <form
            className="pad"
            onSubmit={(e) => {
              e.preventDefault();
              void request("POST", `/v1/citizen/tickets/${ticketId}/notes`, { body: reply });
            }}
          >
            <textarea required value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to citizen" rows={3} style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Sending…" : "Send reply"}</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setMode(null)}>Cancel</button>
          </form>
        </div>
      ) : null}
      {mode === "assign" ? (
        <div className="card" style={{ marginTop: 16, gridColumn: "1 / -1" }}>
          <form
            className="pad"
            onSubmit={(e) => {
              e.preventDefault();
              void request("PATCH", `/v1/citizen/tickets/${ticketId}/assign`, { assigneeId });
            }}
          >
            <input required value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} placeholder="Assignee user UUID" style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Assigning…" : "Assign ticket"}</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setMode(null)}>Cancel</button>
          </form>
        </div>
      ) : null}
      {mode === "resolve" ? (
        <div className="card" style={{ marginTop: 16, gridColumn: "1 / -1" }}>
          <form
            className="pad"
            onSubmit={(e) => {
              e.preventDefault();
              void request("PATCH", `/v1/citizen/tickets/${ticketId}/resolve`, { note: resolveNote || undefined });
            }}
          >
            <textarea value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="Resolution note (optional)" rows={2} style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Resolving…" : "Mark resolved"}</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setMode(null)}>Cancel</button>
          </form>
        </div>
      ) : null}
      {message ? <p style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>{message}</p> : null}
    </>
  );
}
