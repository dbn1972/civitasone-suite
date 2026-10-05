"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { rupeesToMinorString } from "@/lib/money";
import { saveClassification, type ClassificationPatch, type Temperature, type Priority } from "@/lib/crm/leadQualification";
import { buildContactPatch, isEmptyPatch } from "@/lib/crm/contactPatch";
import { ClassificationFields, type ClassificationFormValue } from "../../../../../_components/crm/ClassificationFields";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { ArrowLeft } from "lucide-react";

type Initial = {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  designation?: string;
  city?: string;
  leadStatus?: string;
  marketingConsent?: boolean;
  temperature?: string;
  priority?: string;
  segment?: string;
  product?: string;
  region?: string;
  expectedValueMinor?: string;
};

/** Masked email/phone shown as placeholders when the viewer may not read PII (server-masked). */
type MaskedPii = { email?: string; phone?: string; hint: string };
type Props = { params: { id: string }; initial: Initial; maskedPii?: MaskedPii };

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/** Paise integer string → rupees decimal string for the money input prefill. */
function minorToRupees(minor?: string): string {
  if (!minor) return "";
  if (!/^\d+$/.test(minor)) return "";
  const n = BigInt(minor);
  const rupees = n / 100n;
  const paise = n % 100n;
  return paise === 0n ? rupees.toString() : `${rupees}.${paise.toString().padStart(2, "0")}`;
}

function isTemperature(v: string): v is Temperature {
  return v === "hot" || v === "warm" || v === "cold";
}
function isPriority(v: string): v is Priority {
  return v === "high" || v === "medium" || v === "low";
}

export default function EditContactForm({ params, initial, maskedPii }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name,
    email: initial.email ?? "",
    phone: initial.phone ?? "",
    company: initial.organization ?? "",
    designation: initial.designation ?? "",
    city: initial.city ?? "",
    marketingConsent: initial.marketingConsent ?? false,
  });
  const [classification, setClassification] = useState<ClassificationFormValue>({
    temperature: initial.temperature && isTemperature(initial.temperature) ? initial.temperature : "",
    priority: initial.priority && isPriority(initial.priority) ? initial.priority : "",
    segment: initial.segment ?? "",
    product: initial.product ?? "",
    region: initial.region ?? "",
    expectedValueRupees: minorToRupees(initial.expectedValueMinor),
  });
  const [evError, setEvError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("contact");
  const t = useTranslations("crmEditContactForm");

  function updateClassification(patch: Partial<ClassificationFormValue>) {
    setClassification((c) => ({ ...c, ...patch }));
    if ("expectedValueRupees" in patch) setEvError("");
  }

  /**
   * Build the classification PATCH body, converting rupees→paise. An empty
   * selection/field is sent as explicit `null` so picking "—" (or clearing a
   * text field) clears the stored value — the classify consumer treats null as
   * "clear", whereas omitting the key would leave the old value in place.
   * Returns the sentinel `INVALID` when the expected value is present but not a
   * valid amount, so the caller can surface an inline error.
   */
  function buildClassificationPatch(): ClassificationPatch | "INVALID" {
    const ev = classification.expectedValueRupees.trim();
    let expectedValueMinor: string | null = null;
    if (ev) {
      const minor = rupeesToMinorString(ev);
      if (!minor) return "INVALID";
      expectedValueMinor = minor;
    }
    return {
      temperature: classification.temperature || null,
      priority: classification.priority || null,
      segment: classification.segment.trim() || null,
      product: classification.product.trim() || null,
      region: classification.region.trim() || null,
      expectedValueMinor,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    setEvError("");

    const classificationPatch = buildClassificationPatch();
    if (classificationPatch === "INVALID") {
      setEvError("Enter expected value as a positive amount in rupees (up to 2 decimals).");
      return;
    }

    setBusy(true);
    try {
      // GAP-CRM-CONTACTS-DETAIL-EDIT-01: send only changed fields, mapping a
      // cleared field to explicit null (DPDP correction/erasure). leadStatus is
      // deliberately NOT part of this patch — see GAP-CRM-CONTACTS-DETAIL-EDIT-02
      // (status changes must go through the governed LeadTransitionControl).
      const corePatch = buildContactPatch(
        {
          name: initial.name,
          email: initial.email,
          phone: initial.phone,
          company: initial.organization,
          designation: initial.designation,
          city: initial.city,
        },
        {
          name: form.name,
          email: form.email,
          phone: form.phone,
          company: form.company,
          designation: form.designation,
          city: form.city,
        },
      );
      // Marketing consent only when it actually changed.
      const consentChanged = form.marketingConsent !== (initial.marketingConsent ?? false);
      const body: Record<string, unknown> = { ...corePatch };
      if (consentChanged) body.marketingConsent = form.marketingConsent;

      // Skip the core PATCH entirely when nothing core/consent changed, but
      // still persist a classification change below.
      if (!isEmptyPatch(corePatch) || consentChanged) {
        const res = await browserFetch(`v1/crm/contacts/${params.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      }
      // LQ-003: persist classification on its dedicated endpoint.
      await saveClassification(params.id, classificationPatch);
      setMessage("Contact updated.");
      setTimeout(() => router.push(`/crm/contacts/${params.id}`), 500);
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href={`/crm/contacts/${params.id}`}><ArrowLeft aria-hidden="true" size={14} /> Contact</a>
      <div className="ph" style={{ marginTop: 6 }}><h1>Edit Contact</h1></div>
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{error}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad" style={{ display: "grid", gap: 14, maxWidth: 720 }}>
          <div>
            <label htmlFor="edit-name" style={labelStyle}>Full name</label>
            <input id="edit-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-email" style={labelStyle}>Email</label>
            <input id="edit-email" type="email" value={form.email} placeholder={maskedPii?.email} aria-describedby={maskedPii ? "edit-pii-hint" : undefined} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-phone" style={labelStyle}>Phone</label>
            <input id="edit-phone" value={form.phone} placeholder={maskedPii?.phone} aria-describedby={maskedPii ? "edit-pii-hint" : undefined} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputStyle} />
            {maskedPii ? <p id="edit-pii-hint" style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>{maskedPii.hint}</p> : null}
          </div>
          <div>
            <label htmlFor="edit-company" style={labelStyle}>Organisation</label>
            <input id="edit-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-designation" style={labelStyle}>Designation</label>
            <input id="edit-designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="edit-city" style={labelStyle}>City</label>
            <input id="edit-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{t("leadStatus")}</span>
            {/* GAP-CRM-CONTACTS-DETAIL-EDIT-02: status changes are governed
                (reason/transition rules + audit) and must go through the
                Change lead status control on the contact page, not this
                generic edit form. Shown read-only here. */}
            <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontWeight: 600 }}>
                {(initial.leadStatus ?? "new").charAt(0).toUpperCase() + (initial.leadStatus ?? "new").slice(1)}
              </span>
              <a className="link" href={`/crm/contacts/${params.id}`}>{t("changeStatus")}</a>
            </p>
          </div>

          <ClassificationFields value={classification} onChange={updateClassification} expectedValueError={evError} />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
            Marketing consent (DPDP)
          </label>
          <div>
            <Button type="submit" disabled={busy} loading={busy} style={{ minHeight: 44 }}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      </div>
    </>
  );
}
