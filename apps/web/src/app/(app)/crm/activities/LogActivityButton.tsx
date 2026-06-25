"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ContactOption = { id: string; name: string };

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function LogActivityButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [form, setForm] = useState({ contactId: "", type: "call", subject: "", text: "", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/crm/contacts");
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
        if (!active) return;
        setContacts(
          (body.data ?? [])
            .filter((c): c is { id: string; name: string } => Boolean(c.id && c.name))
            .map((c) => ({ id: c.id, name: c.name })),
        );
      } catch {
        /* contact picker is optional */
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/crm/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(form.contactId ? { contactId: form.contactId } : {}),
          type: form.type,
          subject: form.subject || form.text.slice(0, 80),
          text: form.text,
          status: "open",
          ...(form.dueDate ? { dueDate: form.dueDate } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Could not log the activity.");
      setMessage("Activity logged.");
      setForm({ contactId: "", type: "call", subject: "", text: "", dueDate: "" });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log the activity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen((v) => !v)} style={{ minHeight: 44 }}>
        + Log Activity
      </button>
      {open ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={submit} className="pad" style={{ maxWidth: 560 }}>
            <h4 style={{ marginTop: 0 }}>Log an activity</h4>
            <label htmlFor="act-contact" style={labelStyle}>Contact (optional)</label>
            <select id="act-contact" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} style={inputStyle}>
              <option value="">— No contact —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label htmlFor="act-type" style={labelStyle}>Type</label>
            <select id="act-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inputStyle}>
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="email">Email</option>
              <option value="task">Task</option>
              <option value="note">Note</option>
            </select>
            <label htmlFor="act-subject" style={labelStyle}>Subject</label>
            <input id="act-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Short summary" style={inputStyle} />
            <label htmlFor="act-due" style={labelStyle}>Due date (optional)</label>
            <input id="act-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={inputStyle} />
            <label htmlFor="act-notes" style={labelStyle}>Notes</label>
            <textarea id="act-notes" required value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="What happened or needs doing?" rows={3} style={{ ...inputStyle, minHeight: undefined }} />
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>
              {busy ? "Saving…" : "Save activity"}
            </button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setOpen(false)}>
              Cancel
            </button>
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
