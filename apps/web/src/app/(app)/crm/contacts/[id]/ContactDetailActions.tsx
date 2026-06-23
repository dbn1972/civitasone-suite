"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { contactId: string; name: string };

export function ContactDetailActions({ contactId, name }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState({ type: "call", subject: "", text: "" });

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/crm/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactId,
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
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setShowActivity(true)}>Log Activity</button>
      <a className="btn ghost" href={`/crm/contacts/${contactId}/edit`}>Edit</a>
      {showActivity ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={logActivity} className="pad">
            <h4 style={{ marginTop: 0 }}>Log activity for {name}</h4>
            <select value={activity.type} onChange={(e) => setActivity({ ...activity, type: e.target.value })} style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }}>
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="email">Email</option>
              <option value="task">Task</option>
              <option value="note">Note</option>
            </select>
            <input value={activity.subject} onChange={(e) => setActivity({ ...activity, subject: e.target.value })} placeholder="Subject" style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <textarea required value={activity.text} onChange={(e) => setActivity({ ...activity, text: e.target.value })} placeholder="Notes" rows={3} style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save activity"}</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={() => setShowActivity(false)}>Cancel</button>
          </form>
        </div>
      ) : null}
      {message ? <p style={{ fontSize: 13, color: "#047857", marginTop: 8 }}>{message}</p> : null}
    </>
  );
}
