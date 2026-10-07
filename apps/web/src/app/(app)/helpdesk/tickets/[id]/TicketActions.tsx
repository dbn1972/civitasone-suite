"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, EntityPicker } from "../../../../_components/ds";
import { searchIdentityUsers, resolveIdentityUsers } from "@/lib/entityAdapters/identityUser";
import { useFormError } from "@/lib/useFormError";

type Props = {
  ticketId: string;
  /** Current ticket status — gates which actions are offered. */
  status?: string;
  /** Whether the viewer holds a helpdesk/citizen staff role (server-derived). */
  canAct?: boolean;
};

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

export function TicketActions({ ticketId, status, canAct = true }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [mode, setMode] = useState<Mode>(null);

  // composer / form state
  const [reply, setReply] = useState("");
  // GAP-HELPDESK-TICKETS-DETAIL-03: reply can be a citizen-visible reply or an
  // internal note; the composer must say which, and label the success message
  // accordingly. citizen-service's /notes endpoint stores a note; there is no
  // isInternal column today (verified in citizen-service helpdesk/schema.ts),
  // so an "Internal note" prefixes the body with [INTERNAL] until the backend
  // grows a real flag — recorded as a DECISION, and it stops a staff aside
  // from silently being labelled a citizen reply.
  const [replyKind, setReplyKind] = useState<"citizen" | "internal">("citizen");
  const [assigneeId, setAssigneeId] = useState("");
  // Track the chosen agent's display label so the confirm dialog can name them.
  const [assigneeLabel, setAssigneeLabel] = useState("");
  const [resolveNote, setResolveNote] = useState("");

  // confirm dialogs: which destructive action is pending confirmation
  const [confirm, setConfirm] = useState<null | "assign" | "resolve" | "close">(null);
  const [confirmErr, setConfirmErr] = useState<string | undefined>(undefined);
  const formError = useFormError("ticket");

  const replyId = useId();
  const resolveNoteId = useId();

  // GAP-HELPDESK-TICKETS-DETAIL-04: gate actions by status. Closed tickets
  // offer nothing; resolved tickets offer only Close; otherwise all four.
  const normalizedStatus = (status ?? "").toLowerCase();
  const isClosed = normalizedStatus === "closed";
  const isResolved = normalizedStatus === "resolved";
  const showReply = canAct && !isClosed;
  const showAssign = canAct && !isClosed;
  const showResolve = canAct && !isClosed && !isResolved;
  const showClose = canAct && !isClosed;

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
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
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
    setReplyKind("citizen");
    setAssigneeId("");
    setAssigneeLabel("");
    setResolveNote("");
    router.refresh();
  }

  // Reply is a non-destructive message — send directly, no confirm gate.
  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    try {
      // GAP-HELPDESK-TICKETS-DETAIL-03: when "Internal note" is selected, prefix
      // the body with [INTERNAL] so it's distinguishable from citizen-visible
      // messages. The backend has no isInternal flag today (citizen-service
      // helpdesk/schema.ts citizen_ticket_notes lacks the column); this is a
      // convention until the column is added.
      const body = replyKind === "internal" ? `[INTERNAL] ${reply}` : reply;
      await request("POST", `/v1/citizen/tickets/${ticketId}/notes`, { body });
      onSuccess(replyKind === "internal" ? "Internal note added." : "Reply sent to the citizen.");
    } catch (caught) {
      setResult({ kind: "err", text: formError.fromException("save", caught).message });
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
    } catch (caught) {
      setConfirmErr(formError.fromException("save", caught).message);
    }
  }

  return (
    <>
      {showReply && (
        <button type="button" className="btn primary" onClick={() => { setResult(null); setMode("reply"); }}>
          Reply
        </button>
      )}
      {showAssign && (
        <button type="button" className="btn ghost" onClick={() => { setResult(null); setMode("assign"); }}>
          Assign
        </button>
      )}
      {showResolve && (
        <button type="button" className="btn ghost" onClick={() => { setResult(null); setMode("resolve"); }}>
          Resolve
        </button>
      )}
      {showClose && (
        <button type="button" className="btn ghost" onClick={() => { setResult(null); setConfirmErr(undefined); setConfirm("close"); }}>
          Close
        </button>
      )}

      {mode === "reply" ? (
        <div className="card" style={{ marginTop: 16, gridColumn: "1 / -1" }}>
          <form className="pad" onSubmit={sendReply}>
            <fieldset style={{ border: "none", padding: 0, margin: "0 0 10px" }}>
              <legend style={labelStyle}>Message type</legend>
              <label style={{ marginInlineEnd: 16, fontSize: 13 }}>
                <input
                  type="radio"
                  name="replyKind"
                  value="citizen"
                  checked={replyKind === "citizen"}
                  onChange={() => setReplyKind("citizen")}
                  style={{ marginInlineEnd: 6 }}
                />
                Reply to citizen
              </label>
              <label style={{ fontSize: 13 }}>
                <input
                  type="radio"
                  name="replyKind"
                  value="internal"
                  checked={replyKind === "internal"}
                  onChange={() => setReplyKind("internal")}
                  style={{ marginInlineEnd: 6 }}
                />
                Internal note
              </label>
            </fieldset>
            {replyKind === "citizen" ? (
              <p role="note" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px" }}>
                This message will be sent to the citizen.
              </p>
            ) : (
              <p role="note" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px" }}>
                Internal notes are for staff only and are not sent to the citizen.
              </p>
            )}
            <label htmlFor={replyId} style={labelStyle}>
              {replyKind === "internal" ? "Internal note" : "Reply to citizen"}
            </label>
            <textarea
              id={replyId}
              required
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={replyKind === "internal" ? "Add a note for staff…" : "Type your reply…"}
              rows={3}
              style={inputStyle}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Sending…" : replyKind === "internal" ? "Add internal note" : "Send reply"}
            </button>
            <button type="button" className="btn ghost" style={{ marginInlineStart: 8 }} onClick={() => setMode(null)}>
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
              if (!assigneeId) return;
              setResult(null);
              setConfirmErr(undefined);
              setConfirm("assign");
            }}
          >
            <span style={labelStyle}>Assign to agent</span>
            <EntityPicker
              value={assigneeId || null}
              onChange={(v) => {
                const id = Array.isArray(v) ? v[0] ?? "" : v ?? "";
                setAssigneeId(id);
                // Resolve the display label for the confirm dialog.
                if (id) {
                  resolveIdentityUsers([id]).then((opts) => {
                    const label = opts[0]?.label ?? id.slice(0, 8);
                    setAssigneeLabel(label);
                  }).catch(() => setAssigneeLabel(id.slice(0, 8)));
                } else {
                  setAssigneeLabel("");
                }
              }}
              search={searchIdentityUsers}
              resolve={resolveIdentityUsers}
              placeholder="Search by agent name…"
              aria-label="Select agent to assign"
            />
            <div style={{ marginTop: 10 }}>
              <button type="submit" className="btn primary" disabled={busy || !assigneeId}>Assign ticket…</button>
              <button type="button" className="btn ghost" style={{ marginInlineStart: 8 }} onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
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
            <button type="button" className="btn ghost" style={{ marginInlineStart: 8 }} onClick={() => setMode(null)}>
              Cancel
            </button>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "assign"}
        title="Assign this ticket?"
        description={`Assign to ${assigneeLabel || "the selected agent"}? They will become responsible for this ticket and will be notified.`}
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
            color: result.kind === "err" ? "var(--bad)" : "var(--good)",
          }}
        >
          <span aria-hidden="true">{result.kind === "err" ? "⚠" : "✓"}</span>
          {result.text}
        </p>
      ) : null}
    </>
  );
}
