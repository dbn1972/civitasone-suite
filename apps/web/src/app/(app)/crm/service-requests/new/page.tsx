"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";

/**
 * Service types a citizen can raise a request against. Kept alongside the
 * grievance categories rather than shared with them: a grievance is a complaint
 * about a service already delivered, a request asks for one to be delivered, and
 * the two taxonomies diverge in practice.
 */
const SERVICE_TYPES = [
  "New Water Connection",
  "New Electricity Connection",
  "Birth Certificate",
  "Death Certificate",
  "Property Mutation",
  "Trade Licence",
  "Building Permission",
  "Waste Collection",
  "Street Light Installation",
  "Other",
];

const FIELD: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 14,
};

const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 14 };

export default function NewServiceRequestPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      citizenName: fd.get("citizenName"),
      citizenPhone: fd.get("citizenPhone") || undefined,
      citizenEmail: fd.get("citizenEmail") || undefined,
      serviceType: fd.get("serviceType"),
      subject: fd.get("subject"),
      description: fd.get("description") || undefined,
      priority: fd.get("priority"),
    };

    try {
      const res = await fetch("/api/proxy/v1/crm/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      const { data } = (await res.json()) as { data: { id: string } };
      router.push(`/crm/service-requests/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Service Request"
        subtitle="Log a citizen service request."
        back="/crm/service-requests"
        backLabel="Service Requests"
      />
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r)",
          padding: "24px 28px",
          maxWidth: 640,
        }}
      >
        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              background: "color-mix(in srgb, var(--bad) 10%, transparent)",
              border: "1px solid var(--bad)",
              borderRadius: "var(--r)",
              color: "var(--bad)",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Citizen Details</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={LABEL}>
                <span style={{ color: "var(--ink)" }}>
                  Full Name <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                </span>
                <input name="citizenName" required maxLength={200} placeholder="Enter citizen's full name" style={FIELD} />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>Phone</span>
                  <input name="citizenPhone" type="tel" maxLength={32} placeholder="e.g. 9876543210" style={FIELD} />
                </label>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>Email</span>
                  <input name="citizenEmail" type="email" maxLength={320} placeholder="citizen@example.com" style={FIELD} />
                </label>
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Request Details</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>
                    Service Type <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                  </span>
                  <select name="serviceType" required style={FIELD}>
                    <option value="">Select service type…</option>
                    {SERVICE_TYPES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>Priority</span>
                  <select name="priority" defaultValue="normal" style={FIELD}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
              </div>
              <label style={LABEL}>
                <span style={{ color: "var(--ink)" }}>
                  Subject <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                </span>
                <input name="subject" required maxLength={500} placeholder="Brief one-line description of the request" style={FIELD} />
              </label>
              <label style={LABEL}>
                <span style={{ color: "var(--ink)" }}>Description</span>
                <textarea
                  name="description"
                  rows={4}
                  maxLength={5000}
                  placeholder="Detailed description of the service request…"
                  style={{ ...FIELD, resize: "vertical" }}
                />
              </label>
            </div>
          </fieldset>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <a href="/crm/service-requests" className="btn">Cancel</a>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving…" : "Submit Request"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
