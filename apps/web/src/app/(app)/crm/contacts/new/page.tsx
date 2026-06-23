"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewContactPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", designation: "", city: "",
    leadStatus: "new", leadSource: "", marketingConsent: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/crm/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          company: form.company || undefined,
          designation: form.designation || undefined,
          city: form.city || undefined,
          leadStatus: form.leadStatus,
          leadSource: form.leadSource || undefined,
          marketingConsent: form.marketingConsent,
        }),
      });
      const body = await res.json().catch(() => ({})) as { id?: string };
      if (!res.ok) throw new Error(await res.text());
      setMessage("Contact created.");
      if (body.id) setTimeout(() => router.push(`/crm/contacts/${body.id}`), 500);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href="/crm/contacts">← Contacts</a>
      <div className="ph" style={{ marginTop: 6 }}>
        <h1>New Contact</h1>
        <div className="sub">Oracle/SAP-style contact master — lead capture with consent tracking.</div>
      </div>
      {message ? <div className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div> : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <input required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input placeholder="Organisation" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input placeholder="Designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <select value={form.leadStatus} onChange={(e) => setForm({ ...form, leadStatus: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="unqualified">Unqualified</option>
              <option value="customer">Customer</option>
            </select>
            <input placeholder="Lead source" value={form.leadSource} onChange={(e) => setForm({ ...form, leadSource: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
            <input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
            Marketing consent (GDPR/DPDP)
          </label>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 16 }}>{busy ? "Creating…" : "Create contact"}</button>
        </form>
      </div>
    </>
  );
}
