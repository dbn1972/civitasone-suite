"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 } as const;
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 4 } as const;
const errStyle = { fontSize: 12, color: "#b42318", marginTop: 4 } as const;

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman & Nicobar Islands", "Chandigarh", "Dadra & Nagar Haveli and Daman & Diu",
  "Delhi", "Jammu & Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

export default function NewDomainPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    domainName: "",
    organisation: "",
    contactEmail: "",
    contactPhone: "",
    department: "",
    state: "",
    domainType: "gov.in",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!form.domainName.match(/^[a-z0-9.-]+\.(gov\.in|nic\.in|gov\.in|in)$/i)) {
      fe.domainName = "Enter a valid .gov.in or .nic.in domain.";
    }
    if (!form.contactEmail.includes("@")) {
      fe.contactEmail = "Enter a valid email address.";
    }
    if (Object.keys(fe).length > 0) {
      setFieldErrors(fe);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Registration failed: ${res.status}`);
      }
      const body = await res.json() as { id?: string };
      router.push(body.id ? `/domains/${body.id}` : "/domains");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register domain.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Register New Domain"
        subtitle="Add a government domain for GovUX audit and WCAG compliance tracking."
        back="/domains"
        backLabel="Domains"
      />

      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}
        >
          {error}
        </div>
      )}

      <div className="card">
        <form onSubmit={handleSubmit} style={{ padding: 24 }}>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 18 }}>
            Fields marked * are required.
          </p>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: 20 }}>
            {/* Domain Name */}
            <div>
              <label htmlFor="domain-name" style={labelStyle}>
                Domain Name *
              </label>
              <input
                id="domain-name"
                type="text"
                value={form.domainName}
                onChange={(e) => { setForm({ ...form, domainName: e.target.value.toLowerCase() }); setFieldErrors((f) => ({ ...f, domainName: "" })); }}
                placeholder="example.gov.in"
                style={{ ...inputStyle, borderColor: fieldErrors.domainName ? "#dc2626" : "#d1d5db" }}
                required
                aria-required="true"
                aria-describedby={fieldErrors.domainName ? "domain-name-err" : undefined}
                aria-invalid={fieldErrors.domainName ? true : undefined}
              />
              {fieldErrors.domainName && (
                <p id="domain-name-err" role="alert" aria-live="polite" style={errStyle}>
                  {fieldErrors.domainName}
                </p>
              )}
            </div>

            {/* Domain Type */}
            <div>
              <label htmlFor="domain-type" style={labelStyle}>
                Domain Type *
              </label>
              <select
                id="domain-type"
                value={form.domainType}
                onChange={(e) => setForm({ ...form, domainType: e.target.value })}
                style={inputStyle}
                required
                aria-required="true"
              >
                <option value="gov.in">.gov.in — Central Government</option>
                <option value="nic.in">.nic.in — NIC Hosted</option>
                <option value="state.gov.in">State Government</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Organisation */}
            <div>
              <label htmlFor="domain-organisation" style={labelStyle}>
                Organisation *
              </label>
              <input
                id="domain-organisation"
                type="text"
                value={form.organisation}
                onChange={(e) => setForm({ ...form, organisation: e.target.value })}
                placeholder="Ministry of Electronics and IT"
                style={inputStyle}
                required
                aria-required="true"
              />
            </div>

            {/* Department */}
            <div>
              <label htmlFor="domain-department" style={labelStyle}>
                Department / Division
              </label>
              <input
                id="domain-department"
                type="text"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="e.g. Digital India Division"
                style={inputStyle}
              />
            </div>

            {/* State */}
            <div>
              <label htmlFor="domain-state" style={labelStyle}>
                State / UT
              </label>
              <select
                id="domain-state"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                style={inputStyle}
              >
                <option value="">— Select state / UT —</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Contact Email */}
            <div>
              <label htmlFor="domain-contact-email" style={labelStyle}>
                Contact Email *
              </label>
              <input
                id="domain-contact-email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => { setForm({ ...form, contactEmail: e.target.value }); setFieldErrors((f) => ({ ...f, contactEmail: "" })); }}
                placeholder="webmaster@example.gov.in"
                style={{ ...inputStyle, borderColor: fieldErrors.contactEmail ? "#dc2626" : "#d1d5db" }}
                required
                aria-required="true"
                aria-describedby={fieldErrors.contactEmail ? "domain-contact-email-err" : undefined}
                aria-invalid={fieldErrors.contactEmail ? true : undefined}
              />
              {fieldErrors.contactEmail && (
                <p id="domain-contact-email-err" role="alert" aria-live="polite" style={errStyle}>
                  {fieldErrors.contactEmail}
                </p>
              )}
            </div>

            {/* Contact Phone */}
            <div>
              <label htmlFor="domain-contact-phone" style={labelStyle}>
                Contact Phone
              </label>
              <input
                id="domain-contact-phone"
                type="tel"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                placeholder="011-24301001"
                style={inputStyle}
                inputMode="tel"
              />
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 24 }}>
            <label htmlFor="domain-notes" style={labelStyle}>
              Notes
            </label>
            <textarea
              id="domain-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any relevant context about this domain — e.g. legacy CMS, prior audit findings…"
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => router.back()}
              style={{ padding: "10px 22px", borderRadius: 8, background: "#f3f4f6", color: "#374151", fontWeight: 600, border: "1px solid #d1d5db", cursor: "pointer", fontSize: 14 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              style={{
                padding: "10px 28px",
                borderRadius: 8,
                background: busy ? "#9ca3af" : "#4f46e5",
                color: "#fff",
                fontWeight: 600,
                border: "none",
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: 14,
              }}
            >
              {busy ? "Registering…" : "Register Domain"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
