"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "../../../../_components/ds";

/**
 * Closes a conversation.
 *
 * GAP-AI-CHAT-DETAIL-01: ending a conversation is irreversible (ai-agent-service
 * rejects re-opening) and, for a citizen mid-chat, cuts the session — so it now
 * goes through a danger ConfirmDialog that requires a reason (>= 10 chars)
 * before the request fires, rather than a single click on a danger button.
 *
 * GAP-AI-CHAT-DETAIL-06: the reason field no longer tells the operator to
 * "record here if this was handed to a human agent" — handoff is its own
 * control (HandoffButton), so recording it here as closing text was a second,
 * conflicting way to capture one fact. The reason is simply why the
 * conversation is being ended.
 *
 * Both an active conversation and one already with a human agent can be closed;
 * the button is hidden once it has ended, since the service rejects that
 * transition.
 */
export function EndConversationButton({
  conversationId,
  version,
}: {
  conversationId: string;
  version: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function end(reason?: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/ai/chat/${conversationId}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        if (body.code === "INVALID_TRANSITION") {
          setError("This conversation has already ended. Reload to see its current state.");
          return;
        }
        if (body.code === "VERSION_CONFLICT") {
          setError("Someone else updated this conversation. Reload and try again.");
          return;
        }
        if (res.status === 403) {
          setError("You do not have permission to end this conversation.");
          return;
        }
        setError("Could not end the conversation.");
        return;
      }
      setMessage("Conversation ended. The transcript is preserved.");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the service. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h"><h3>End Conversation</h3></div>
      <div className="pad">
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          Ending a conversation is final — the citizen&apos;s session is closed and it cannot be reopened.
        </p>
        <button
          type="button"
          className="btn danger"
          onClick={() => { setError(""); setOpen(true); }}
          disabled={busy}
          style={{ minHeight: 44 }}
        >
          End conversation
        </button>
        {message ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginTop: 12, marginBottom: 0 }}>
            {message}
          </p>
        ) : null}
        {error && !open ? (
          <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad)", marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={open}
        danger
        title="End conversation?"
        description="This closes the conversation for the citizen and cannot be undone. Give a short reason for the record."
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel="Reason for ending"
        confirmLabel="End conversation"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => { void end(reason); }}
        onCancel={() => { if (!busy) setOpen(false); }}
      />
    </div>
  );
}
