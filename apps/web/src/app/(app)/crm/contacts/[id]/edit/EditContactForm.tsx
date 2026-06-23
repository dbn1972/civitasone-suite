"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { contactId: string; initial: { name: string; email?: string; phone?: string; organization?: string; designation?: string; city?: string; leadStatus?: string; marketingConsent?: boolean } };

export default function EditContactPage({ params, initial }: { params: { id: string }; initial: Props["initial"] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name,
    email: initial.email ?? "",
    phone: initial.phone ?? "",
    company: initial.organization ?? "",
    designation: initial.designation ?? "",
    city: initial.city ?? "",
    leadStatus: initial.leadStatus ?? "new",
    marketingConsent: initial.marketingConsent ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/crm/contacts/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          company: form.company || undefined,
          designation: form.designation || undefined,
          city: form.city || undefined,
          leadStatus: form.leadStatus,
          marketingConsent: form.marketingConsent,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Contact updated.");
      setTimeout(() => router.push(`/crm/contacts/${params.id}`), 500);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href={`/crm/contacts/${params.id}`}>← Contact</a>
      <div className="ph" style={{ marginTop: 6 }}><h1>Edit Contact</h1></div>
      {message ? <div className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div> : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }} />
            <select value={form.leadStatus} onChange={(e) => setForm({ ...form, leadStatus: e.target.value })} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="unqualified">Unqualified</option>
              <option value="customer">Customer</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
            <input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
            Marketing consent
          </label>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 16 }}>{busy ? "Saving…" : "Save changes"}</button>
        </form>
      </div>
    </>
  );
}
