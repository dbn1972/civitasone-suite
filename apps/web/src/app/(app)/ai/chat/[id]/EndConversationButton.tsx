"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Closes a conversation with an optional reason.
 *
 * Both an active conversation and one already with a human agent can be closed;
 * the button is hidden once it has ended, since the service rejects that
 * transition. Escalating to a person is a separate control (HandoffButton) so
 * the handoff is recorded as its own state rather than as closing text.
 */
export function EndConversationButton({
  conversationId,
  version,
}: {
  conversationId: string;
  version: number;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function end() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/ai/chat/${conversationId}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        if (body.code === "INVALID_TRANSITION") {
          setError("This conversation has already ended. Reload to see its current state.");
          return;
        }
        if (res.status === 403) {
          setError("You do not have permission to end this conversation.");
          return;
        }
        setError(body.message || "Could not end the conversation.");
        return;
      }
      setMessage("Conversation ended. The transcript is preserved.");
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
        <label htmlFor="end-reason" style={{ display: "block", fontSize: 13, color: "#475569", marginBottom: 6 }}>
          Reason (optional) — record here if this was handed to a human agent
        </label>
        <input
          id="end-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder="e.g. escalated to the water supply desk"
          style={{ width: "100%", padding: 10, fontSize: 14 }}
        />
        <button
          type="button"
          className="btn danger"
          onClick={end}
          disabled={busy}
          style={{ minHeight: 44, marginTop: 12 }}
        >
          {busy ? "Ending…" : "End conversation"}
        </button>
        {message ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 12, marginBottom: 0 }}>
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
