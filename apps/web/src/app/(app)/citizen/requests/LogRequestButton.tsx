"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function LogRequestButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ category: "grievance", subject: "", description: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/proxy/v1/citizen/grievances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: form.category, subject: form.subject, description: form.description }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Could not log the request.");
      setMessage("Request submitted. It will appear in the list once processed.");
      setOpen(false);
      setForm({ category: "grievance", subject: "", description: "" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" style={{ minHeight: 44 }} onClick={() => setOpen((o) => !o)}>
        Log Request
      </button>
      {open && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={submit} className="pad" style={{ maxWidth: 560 }}>
            <h4 style={{ marginTop: 0 }}>Log a service request / grievance</h4>
            <label htmlFor="new-request-category" style={labelStyle}>Category</label>
            <select id="new-request-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle}>
              <option value="grievance">Grievance</option>
              <option value="water">Water supply</option>
              <option value="sanitation">Sanitation</option>
              <option value="roads">Roads</option>
              <option value="electricity">Electricity</option>
              <option value="other">Other</option>
            </select>
            <label htmlFor="new-request-subject" style={labelStyle}>Subject</label>
            <input id="new-request-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Short summary" style={inputStyle} />
            <label htmlFor="new-request-description" style={labelStyle}>Description</label>
            <textarea id="new-request-description" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue" rows={4} style={{ ...inputStyle, minHeight: 100 }} />
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44 }}>{busy ? "Submitting…" : "Submit request"}</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 8, minHeight: 44 }} onClick={() => setOpen(false)}>Cancel</button>
          </form>
        </div>
      )}
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", marginTop: 8 }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", marginTop: 8 }}>{error}</p> : null}
    </>
  );
}
