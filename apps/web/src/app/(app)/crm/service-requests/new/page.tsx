"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, PageHeader } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

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
  const t = useTranslations("crmServiceRequestNew");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const formError = useFormError("service request");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    formError.clear();
    setContactError(null);
    const fd = new FormData(e.currentTarget);
    const citizenPhone = (fd.get("citizenPhone") as string | null)?.trim() || undefined;
    const citizenEmail = (fd.get("citizenEmail") as string | null)?.trim() || undefined;

    // GAP-CRM-SERVICE-REQUESTS-NEW-01 (DPDP + reachability): a request filed with
    // neither phone nor email leaves no way to reach the citizen. Require at
    // least one, client-side, before we attempt the write.
    if (!citizenPhone && !citizenEmail) {
      setContactError(t("contactRequired"));
      return;
    }

    setSaving(true);
    const body = {
      citizenName: fd.get("citizenName"),
      citizenPhone,
      citizenEmail,
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
        await formError.fromResponse(res, "save");
        setSaving(false);
        return;
      }
      const { data } = (await res.json()) as { data: { id: string } };
      router.push(`/crm/service-requests/${data.id}`);
    } catch (caught) {
      formError.fromException("save", caught);
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
        {formError.message && (
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
            {formError.message}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Citizen Details</legend>
            <p role="note" style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 12px" }}>
              {t("dpdpNote")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={LABEL}>
                <span style={{ color: "var(--ink)" }}>
                  Full Name <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                </span>
                <input name="citizenName" required maxLength={200} placeholder="Enter citizen's full name" style={FIELD} />
                {formError.fieldError("citizenName") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("citizenName")}</span>
                )}
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>
                    {t("phone")} <span style={{ color: "var(--ink2)", fontWeight: 400 }}>{t("phoneOrEmailRequired")}</span>
                  </span>
                  <input name="citizenPhone" type="tel" maxLength={32} placeholder="e.g. 9876543210" style={FIELD} aria-invalid={contactError ? true : undefined} />
                </label>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>
                    {t("email")} <span style={{ color: "var(--ink2)", fontWeight: 400 }}>{t("phoneOrEmailRequired")}</span>
                  </span>
                  <input name="citizenEmail" type="email" maxLength={320} placeholder="citizen@example.com" style={FIELD} aria-invalid={contactError ? true : undefined} />
                </label>
              </div>
              {contactError && (
                <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{contactError}</span>
              )}
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
                  {formError.fieldError("serviceType") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("serviceType")}</span>
                  )}
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
                {formError.fieldError("subject") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subject")}</span>
                )}
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
                {formError.fieldError("description") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
                )}
              </label>
            </div>
          </fieldset>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <a href="/crm/service-requests" className="btn">Cancel</a>
            <Button type="submit" disabled={saving} loading={saving}>
              {saving ? "Saving…" : "Submit Request"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
