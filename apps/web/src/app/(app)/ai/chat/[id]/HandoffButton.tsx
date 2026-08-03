"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const REASONS = [
  { value: "agent_initiated", label: "I am taking this over" },
  { value: "requested", label: "Citizen asked for a person" },
  { value: "low_confidence", label: "Assistant could not answer" },
  { value: "guardrail", label: "Guardrail flagged the exchange" },
];

/**
 * Escalates a live conversation to a human agent, carrying the transcript with
 * it so the receiving officer does not ask the citizen to start again. The
 * service builds that context — this only supplies the reason and routing.
 *
 * Shown only while the conversation is active: ai-agent-service rejects
 * escalating a conversation that has already been handed off or ended.
 */
export function HandoffButton({
  conversationId,
  version,
}: {
  conversationId: string;
  version: number;
}) {
  const router = useRouter();
  const [reasonCode, setReasonCode] = useState("agent_initiated");
  const [queue, setQueue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handOff() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(
        `/api/proxy/v1/ai/chat/${conversationId}/handoff`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version,
            reasonCode,
            ...(queue.trim() ? { queue: queue.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        if (body.code === "INVALID_TRANSITION") {
          setError(
            "This conversation is no longer with the assistant. Reload to see its current state.",
          );
          return;
        }
        if (body.code === "VERSION_CONFLICT") {
          setError(
            "Someone else updated this conversation. Reload and try again.",
          );
          return;
        }
        if (res.status === 403) {
          setError("You do not have permission to hand off this conversation.");
          return;
        }
        setError(body.message || "Could not hand off the conversation.");
        return;
      }
      setMessage("Handed off. The agent receives the transcript so far.");
      router.refresh();
    } catch {
      setError("Could not reach the service. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3>Hand off to a human agent</h3>
      </div>
      <div className="pad">
        <label
          htmlFor="handoff-reason"
          style={{
            display: "block",
            fontSize: 13,
            color: "#475569",
            marginBottom: 6,
          }}
        >
          Reason
        </label>
        <select
          id="handoff-reason"
          value={reasonCode}
          disabled={busy}
          onChange={(e) => setReasonCode(e.target.value)}
          style={{ width: "100%", padding: 10, fontSize: 14 }}
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <label
          htmlFor="handoff-queue"
          style={{
            display: "block",
            fontSize: 13,
            color: "#475569",
            margin: "12px 0 6px",
          }}
        >
          Route to queue (optional)
        </label>
        <input
          id="handoff-queue"
          type="text"
          value={queue}
          onChange={(e) => setQueue(e.target.value)}
          maxLength={64}
          disabled={busy}
          placeholder="e.g. water-supply-tier2"
          style={{ width: "100%", padding: 10, fontSize: 14 }}
        />

        <label
          htmlFor="handoff-note"
          style={{
            display: "block",
            fontSize: 13,
            color: "#475569",
            margin: "12px 0 6px",
          }}
        >
          Note for the agent (optional)
        </label>
        <input
          id="handoff-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder="e.g. pension arrears since April, already verified"
          style={{ width: "100%", padding: 10, fontSize: 14 }}
        />

        <button
          type="button"
          className="btn"
          onClick={handOff}
          disabled={busy}
          style={{ minHeight: 44, marginTop: 12 }}
        >
          {busy ? "Handing off…" : "Hand off to a human"}
        </button>

        {message ? (
          <p
            role="status"
            aria-live="polite"
            style={{
              fontSize: 13,
              color: "#047857",
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            {message}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            aria-live="assertive"
            style={{
              fontSize: 13,
              color: "#b42318",
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
