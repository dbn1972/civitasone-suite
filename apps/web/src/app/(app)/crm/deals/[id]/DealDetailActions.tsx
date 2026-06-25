"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "../../../../_components/ds";

type Props = {
  dealId: string;
  dealName: string;
  contactId?: string;
  status: string;
};

export function DealDetailActions({ dealId, dealName, contactId, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState({ type: "call", subject: "", text: "" });

  const closed = status === "won" || status === "lost";

  async function markStage(stage: "Won" | "Lost") {
    const res = await fetch(`/api/proxy/v1/crm/deals/${dealId}/stage`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) throw new Error((await res.text()) || `Could not mark deal ${stage.toLowerCase()}.`);
  }

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/crm/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(contactId ? { contactId } : {}),
          dealId,
          type: activity.type,
          subject: activity.subject || activity.text.slice(0, 80),
          text: activity.text,
          status: "completed",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Activity logged.");
      setShowActivity(false);
      setActivity({ type: "call", subject: "", text: "" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log activity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setShowActivity((v) => !v)}>
        Log Activity
      </button>
      <ActionButton
        label="Mark Won"
        className="btn ghost"
        disabled={closed}
        confirmTitle={`Mark “${dealName}” as won?`}
        confirmDescription="This closes the deal as won, sets probability to 100% and is recorded in the audit trail."
        confirmLabel="Mark Won"
        requireReason
        reasonLabel="Reason / closing note"
        onConfirm={() => markStage("Won")}
        onSuccess={() => {
          setMessage("Deal marked won.");
          router.refresh();
        }}
      />
      <ActionButton
        label="Mark Lost"
        className="btn ghost"
        danger
        disabled={closed}
        confirmTitle={`Mark “${dealName}” as lost?`}
        confirmDescription="This closes the deal as lost, sets probability to 0% and is recorded in the audit trail."
        confirmLabel="Mark Lost"
        requireReason
        reasonLabel="Reason for loss"
        onConfirm={() => markStage("Lost")}
        onSuccess={() => {
          setMessage("Deal marked lost.");
          router.refresh();
        }}
      />
      {showActivity ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={logActivity} className="pad">
            <h4 style={{ marginTop: 0 }}>Log activity for {dealName}</h4>
            <label htmlFor="deal-activity-type" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Type
            </label>
            <select
              id="deal-activity-type"
              value={activity.type}
              onChange={(e) => setActivity({ ...activity, type: e.target.value })}
              style={{ width: "100%", padding: 8, marginBottom: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" }}
            >
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="email">Email</option>
              <option value="task">Task</option>
              <option value="note">Note</option>
            </select>
            <label htmlFor="deal-activity-subject" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Subject
            </label>
            <input
              id="deal-activity-subject"
              value={activity.subject}
              onChange={(e) => setActivity({ ...activity, subject: e.target.value })}
              placeholder="Short summary"
              style={{ width: "100%", padding: 8, marginBottom: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" }}
            />
            <label htmlFor="deal-activity-notes" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Notes
            </label>
            <textarea
              id="deal-activity-notes"
              required
              value={activity.text}
              onChange={(e) => setActivity({ ...activity, text: e.target.value })}
              placeholder="What happened?"
              rows={3}
              style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Save activity"}
            </button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setShowActivity(false)}>
              Cancel
            </button>
          </form>
        </div>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
