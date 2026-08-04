"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/** A row of GET /v1/crm/lead-field-rules — only what this form needs (LM-001). */
type LeadFieldRule = { fieldName?: string; required?: boolean; enabled?: boolean };

export default function NewContactPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", designation: "", city: "",
    leadStatus: "new", leadSource: "", marketingConsent: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Which fields this tenant has declared mandatory. The server enforces them with
  // 422; without asking for the configuration the form would let the user type a
  // whole lead before finding out. `name` is always required by the API schema.
  const [required, setRequired] = useState<ReadonlySet<string>>(new Set(["name"]));

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/crm/lead-field-rules");
        if (!res.ok) return;
        const body = await res.json() as { data?: LeadFieldRule[] };
        if (!live) return;
        const names = (body.data ?? [])
          .filter((r) => r.required === true && r.enabled !== false)
          .map((r) => r.fieldName)
          .filter((n): n is string => typeof n === "string" && n.length > 0);
        setRequired(new Set(["name", ...names]));
      } catch {
        // Configuration is an enhancement, never a gate: if this read fails the form
        // still submits and the server still enforces. Falling back to "name only"
        // keeps the page usable offline instead of blocking lead capture.
      }
    })();
    return () => { live = false; };
  }, []);

  /** Label text carries the asterisk so screen readers announce it, not just sighted
   *  users — the visual star must never be the only signal (WCAG 2.2 AA, 1.3.1). */
  function labelFor(field: string, text: string): string {
    return required.has(field) ? `${text} *` : text;
  }

  /** `required` + `aria-required` together: native validation plus an explicit
   *  programmatic signal, since some screen readers do not surface `required`. */
  function requiredProps(field: string): { required: boolean; "aria-required": "true" | "false" } {
    const isRequired = required.has(field);
    return { required: isRequired, "aria-required": isRequired ? "true" : "false" };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
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
      // Read the body exactly ONCE. Calling res.json() and then res.text() throws
      // "body stream already read", which replaced the server's real explanation
      // ("missing mandatory field(s): phone, company") with a fetch-internals error.
      const body = await res.json().catch(() => ({})) as { id?: string; message?: string; code?: string };
      if (!res.ok) throw new Error(body.message ?? "Could not create the contact.");
      setMessage("Contact created.");
      if (body.id) setTimeout(() => router.push(`/crm/contacts/${body.id}`), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the contact.");
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
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{error}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          {/* Explains the asterisk convention in text, so the marker is never the
              only way to know a field is mandatory. */}
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            Fields marked * are required by your organisation.
          </p>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              <label htmlFor="new-name" style={labelStyle}>{labelFor("name", "Full name")}</label>
              <input id="new-name" {...requiredProps("name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Asha Rao" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-email" style={labelStyle}>{labelFor("email", "Email")}</label>
              <input id="new-email" type="email" {...requiredProps("email")} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-phone" style={labelStyle}>{labelFor("phone", "Phone")}</label>
              <input id="new-phone" {...requiredProps("phone")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9900000000" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-company" style={labelStyle}>{labelFor("company", "Organisation")}</label>
              <input id="new-company" {...requiredProps("company")} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Corp" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-designation" style={labelStyle}>{labelFor("designation", "Designation")}</label>
              <input id="new-designation" {...requiredProps("designation")} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="Director" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-city" style={labelStyle}>{labelFor("city", "City")}</label>
              <input id="new-city" {...requiredProps("city")} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Bengaluru" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="new-leadStatus" style={labelStyle}>Lead status</label>
              <select id="new-leadStatus" value={form.leadStatus} onChange={(e) => setForm({ ...form, leadStatus: e.target.value })} style={inputStyle}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="unqualified">Unqualified</option>
                <option value="customer">Customer</option>
              </select>
            </div>
            <div>
              <label htmlFor="new-leadSource" style={labelStyle}>{labelFor("leadSource", "Lead source")}</label>
              <input id="new-leadSource" {...requiredProps("leadSource")} value={form.leadSource} onChange={(e) => setForm({ ...form, leadSource: e.target.value })} placeholder="Website, referral…" style={inputStyle} />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
            <input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
            Marketing consent (GDPR/DPDP)
          </label>
          <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 16, minHeight: 44 }}>{busy ? "Creating…" : "Create contact"}</button>
        </form>
      </div>
    </>
  );
}
