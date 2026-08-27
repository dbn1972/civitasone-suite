"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";

type Props = { ticketId: string };

type Mode = "reply" | "assign" | "resolve" | null;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  marginBottom: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  fontSize: 13,
  fontWeight: 500,
};

export function TicketActions({ ticketId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [mode, setMode] = useState<Mode>(null);

  // composer / form state
  const [reply, setReply] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [resolveNote, setResolveNote] = useState("");

  // confirm dialogs: which destructive action is pending confirmation
  const [confirm, setConfirm] = useState<null | "assign" | "resolve" | "close">(null);
  const [confirmErr, setConfirmErr] = useState<string | undefined>(undefined);

  const replyId = useId();
  const assigneeFieldId = useId();
  const resolveNoteId = useId();

  async function request(method: string, path: string, body?: object): Promise<void> {
    setBusy(true);
    setConfirmErr(undefined);
    try {
      const res = await fetch(`/api/proxy${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        // The API's error body is JSON (e.g. {"code":"VALIDATION_FAILED",
        // "message":"invalid request",...}) — surface the human message
        // instead of dumping the raw JSON into the confirm dialog / result
        // banner. Mirrors NewTicketForm.tsx's error handling.
        const text = await res.text();
        let human = text || `Request failed (${res.status})`;
        try {
          const parsed = JSON.parse(text) as { message?: string };
          if (parsed.message) human = parsed.message;
        } catch {
          /* not JSON — fall back to the raw text above */
        }
        throw new Error(human);
      }
    } finally {
      setBusy(false);
    }
  }

  function onSuccess(text: string) {
    setResult({ kind: "ok", text });
    setMode(null);
    setConfirm(null);
    setReply("");
    setAssigneeId("");
    setResolveNote("");
    router.refresh();
  }

  // Reply is a non-destructive message — send directly, no confirm gate.
  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    try {
      await request("POST", `/v1/citizen/tickets/${ticketId}/notes`, { body: reply });
      onSuccess("Reply sent to the citizen.");
    } catch (err) {
      setResult({ kind: "err", text: err instanceof Error ? err.message : "Failed to send reply." });
    }
  }

  // Confirmed (maker-checker) actions.
  async function runConfirmed(reason?: string) {
    try {
      if (confirm === "assign") {
        await request("PATCH", `/v1/citizen/tickets/${ticketId}/assign`, { assigneeId });
        onSuccess("Ticket assigned.");
      } else if (confirm === "resolve") {
        await request("PATCH", `/v1/citizen/tickets/${ticketId}/resolve`, {
          note: resolveNote || undefined,
        });
        onSuccess("Ticket marked resolved.");
      } else if (confirm === "close") {
        await request("PATCH", `/v1/citizen/tickets/${ticketId}/close`, {
          note: reason || undefined,
        });
        onSuccess("Ticket closed.");
      }
    } catch (err) {
      setConfirmErr(err instanceof Error ? err.message : "Action failed. Please try again.");
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => { setResult(null); setMode("reply"); }}>
        Reply
      </button>
      <button type="button" className="btn ghost" onClick={() => { setResult(null); setMode("assign"); }}>
        Assign
      </button>
      <button type="button" className="btn ghost" onClick={() => { setResult(null); setMode("resolve"); }}>
        Resolve
      </button>
      <button type="button" className="btn ghost" onClick={() => { setResult(null); setConfirmErr(undefined); setConfirm("close"); }}>
        Close
      </button>

      {mode === "reply" ? (
        <div className="card" style={{ marginTop: 16, gridColumn: "1 / -1" }}>
          <form className="pad" onSubmit={sendReply}>
            <label htmlFor={replyId} style={labelStyle}>Reply to citizen</label>
            <textarea
              id={replyId}
              required
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type your reply…"
              rows={3}
              style={inputStyle}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Sending…" : "Send reply"}
            </button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setMode(null)}>
              Cancel
            </button>
          </form>
        </div>
      ) : null}

      {mode === "assign" ? (
        <div className="card" style={{ marginTop: 16, gridColumn: "1 / -1" }}>
          <form
            className="pad"
            onSubmit={(e) => {
              e.preventDefault();
              setResult(null);
              setConfirmErr(undefined);
              setConfirm("assign");
            }}
          >
            <label htmlFor={assigneeFieldId} style={labelStyle}>Assignee user UUID</label>
            <input
              id={assigneeFieldId}
              required
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              style={inputStyle}
            />
            <button type="submit" className="btn primary" disabled={busy}>Assign ticket…</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setMode(null)}>
              Cancel
            </button>
          </form>
        </div>
      ) : null}

      {mode === "resolve" ? (
        <div className="card" style={{ marginTop: 16, gridColumn: "1 / -1" }}>
          <form
            className="pad"
            onSubmit={(e) => {
              e.preventDefault();
              setResult(null);
              setConfirmErr(undefined);
              setConfirm("resolve");
            }}
          >
            <label htmlFor={resolveNoteId} style={labelStyle}>
              Resolution note <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
            </label>
            <textarea
              id={resolveNoteId}
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="Describe how this was resolved…"
              rows={2}
              style={inputStyle}
            />
            <button type="submit" className="btn primary" disabled={busy}>Mark resolved…</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setMode(null)}>
              Cancel
            </button>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "assign"}
        title="Assign this ticket?"
        description="The selected agent becomes responsible for this ticket and will be notified."
        confirmLabel="Assign"
        busy={busy}
        errorMessage={confirmErr}
        onConfirm={() => void runConfirmed()}
        onCancel={() => { if (!busy) setConfirm(null); }}
      />
      <ConfirmDialog
        open={confirm === "resolve"}
        title="Mark this ticket resolved?"
        description="The citizen will be notified that their issue has been resolved. You can reopen it later if needed."
        confirmLabel="Mark resolved"
        busy={busy}
        errorMessage={confirmErr}
        onConfirm={() => void runConfirmed()}
        onCancel={() => { if (!busy) setConfirm(null); }}
      />
      <ConfirmDialog
        open={confirm === "close"}
        title="Close this ticket?"
        description="Closing finalises the ticket. Please record a brief reason for the record."
        confirmLabel="Close ticket"
        danger
        requireReason
        reasonLabel="Closing note"
        busy={busy}
        errorMessage={confirmErr}
        onConfirm={(reason) => void runConfirmed(reason)}
        onCancel={() => { if (!busy) setConfirm(null); }}
      />

      {result ? (
        <p
          role={result.kind === "err" ? "alert" : "status"}
          aria-live={result.kind === "err" ? "assertive" : "polite"}
          style={{
            fontSize: 13,
            marginTop: 8,
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: result.kind === "err" ? "#b91c1c" : "#047857",
          }}
        >
          <span aria-hidden="true">{result.kind === "err" ? "⚠" : "✓"}</span>
          {result.text}
        </p>
      ) : null}
    </>
  );
}
