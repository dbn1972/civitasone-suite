"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "../../../../_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

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

  /**
   * Close via POST /v1/crm/deals/:id/close (outcome + reason), the same
   * dedicated close endpoint _components/crm/CloseOpportunityDialog.tsx uses
   * for the equivalent action on Opportunities — NOT the generic
   * PATCH .../stage (which requires a version we don't have here and has no
   * `reason` field in its schema at all, so a reason sent there would be
   * silently dropped even though the confirm dialog asks for one and claims
   * it's "recorded in the audit trail").
   *
   * Reason min-length: the backend requires >=10 trimmed chars for any
   * non-"won" outcome (REASON_REQUIRED, 400) — see close-routes.ts. The "Mark
   * Lost" button below passes minReasonLength=10 to ConfirmDialog so the UI
   * enforces the same floor instead of letting a 1-2 char reason round-trip
   * to a server error.
   */
  async function closeDeal(outcome: "won" | "lost", reason?: string) {
    const res = await browserFetch(`v1/crm/deals/${dealId}/close`, {
      method: "POST",
      body: JSON.stringify({ outcome, reason: reason ?? "" }),
    });
    if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  }

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await browserFetch("v1/crm/activities", {
        method: "POST",
        body: JSON.stringify({
          ...(contactId ? { contactId } : {}),
          dealId,
          type: activity.type,
          subject: activity.subject || activity.text.slice(0, 80),
          text: activity.text,
          status: "completed",
        }),
      });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
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
        onConfirm={(reason) => closeDeal("won", reason)}
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
        minReasonLength={10}
        onConfirm={(reason) => closeDeal("lost", reason)}
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
