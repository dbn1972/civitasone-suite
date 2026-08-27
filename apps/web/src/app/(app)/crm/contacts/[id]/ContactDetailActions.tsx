"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "../../../../_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

type Props = { contactId: string; name: string };

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function ContactDetailActions({ contactId, name }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState({ type: "call", subject: "", text: "" });

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await browserFetch("v1/crm/activities", {
        method: "POST",
        body: JSON.stringify({
          contactId,
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log the activity.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * `reason` is the maker-checker deletion note collected by ActionButton's
   * ConfirmDialog. It must be forwarded on the request — the backend threads it
   * through to the contactDeleted audit-trail record (see crm-service
   * modules/contacts/{routes,commands,consumer}.ts) — otherwise the dialog's own
   * "recorded in the audit trail" claim would be false: the user types a reason
   * and it goes nowhere.
   */
  async function deleteContact(reason?: string) {
    const res = await browserFetch(`v1/crm/contacts/${contactId}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: reason ?? "" }),
    });
    if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setShowActivity(true)} style={{ minHeight: 44 }}>
        Log Activity
      </button>
      <a className="btn ghost" href={`/crm/contacts/${contactId}/edit`} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
        Edit
      </a>
      <ActionButton
        label="Delete"
        className="btn danger"
        danger
        requireReason
        reasonLabel="Reason for deletion"
        confirmTitle={`Delete ${name}?`}
        confirmDescription="This removes the contact from the CRM. The action is recorded in the audit trail and cannot be undone here."
        confirmLabel="Delete contact"
        onConfirm={deleteContact}
        onSuccess={() => {
          setMessage("Contact deleted.");
          setTimeout(() => router.push("/crm/contacts"), 500);
        }}
      />
      {showActivity ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={logActivity} className="pad" style={{ maxWidth: 520 }}>
            <h4 style={{ marginTop: 0 }}>Log activity for {name}</h4>
            <label htmlFor="contact-activity-type" style={labelStyle}>Type</label>
            <select id="contact-activity-type" value={activity.type} onChange={(e) => setActivity({ ...activity, type: e.target.value })} style={inputStyle}>
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="email">Email</option>
              <option value="task">Task</option>
              <option value="note">Note</option>
            </select>
            <label htmlFor="contact-activity-subject" style={labelStyle}>Subject</label>
            <input id="contact-activity-subject" value={activity.subject} onChange={(e) => setActivity({ ...activity, subject: e.target.value })} placeholder="Short summary" style={inputStyle} />
            <label htmlFor="contact-activity-notes" style={labelStyle}>Notes</label>
            <textarea id="contact-activity-notes" required value={activity.text} onChange={(e) => setActivity({ ...activity, text: e.target.value })} placeholder="What happened?" rows={3} style={{ ...inputStyle, minHeight: undefined }} />
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? "Saving…" : "Save activity"}</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setShowActivity(false)}>Cancel</button>
          </form>
        </div>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p>
      ) : null}
    </>
  );
}
