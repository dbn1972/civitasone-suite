"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, PageHeader, EntityPicker, type EntityOption } from "../../../../_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { getServiceTypes, serviceTypeOptions, DEFAULT_SERVICE_TYPES } from "@/lib/crm/serviceTypes";

/**
 * GAP-CRM-SERVICE-REQUESTS-NEW-04: async server-side contact search for linking a
 * request to an existing CRM contact, over GET /v1/crm/contacts/lookup?q= (id +
 * display name + masked phone/email only). The request's POST already accepts an
 * optional contactId (crm-service service-requests createBody.contactId); linking
 * is optional and never blocks logging the request.
 */
async function searchContacts(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const q = query.trim();
  const res = await browserFetch(`v1/crm/contacts/lookup?q=${encodeURIComponent(q)}&limit=10`, { signal });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  const body = (await res.json()) as { data?: Array<{ id?: string; name?: string; email?: string | null; phone?: string | null }> };
  return (body.data ?? [])
    .filter((c): c is { id: string; name: string; email?: string | null; phone?: string | null } => Boolean(c.id && c.name))
    .map((c) => ({ id: c.id, label: c.name, ...(c.email || c.phone ? { sublabel: [c.phone, c.email].filter(Boolean).join(" · ") } : {}) }));
}

/**
 * Service types a citizen can raise a request against. Kept alongside the
 * grievance categories rather than shared with them: a grievance is a complaint
 * about a service already delivered, a request asks for one to be delivered, and
 * the two taxonomies diverge in practice.
 *
 * GAP-CRM-SERVICE-REQUESTS-NEW-02: the authoritative list is now the per-tenant
 * service-type master (crm.service_types, admin page /crm/service-types). This
 * constant is kept ONLY as the labelled fallback used when the tenant has
 * configured no active types or the master fails to load — so the select is
 * never empty and no deploy is needed to add a type.
 */
const SERVICE_TYPES_FALLBACK = DEFAULT_SERVICE_TYPES.map((t) => t.label);

const FIELD: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 14,
};

const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 14 };

/**
 * GAP-CRM-SERVICE-REQUESTS-NEW-05: validate the citizen phone as an Indian
 * 10-digit mobile (optionally +91 / 0 prefixed, spaces/hyphens tolerated)
 * before filing — a free-form tel input with maxLength 32 and no pattern let a
 * clearly-wrong "12345" through to the server. Email format is checked too. The
 * server remains authoritative. Decision (recorded in report): mobile-only
 * (landlines/STD rejected) to match the acceptance; relax to STD if the desk
 * needs it.
 */
const INDIAN_MOBILE_RE = /^(?:\+?91[-\s]?|0)?[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @returns an error string, or null when valid / blank (phone is optional alone). */
function phoneFormatError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const normalised = value.replace(/[-\s]/g, "");
  if (INDIAN_MOBILE_RE.test(normalised)) return null;
  return "Enter a valid 10-digit Indian mobile number (optionally +91).";
}

function emailFormatError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return EMAIL_RE.test(value) ? null : "Enter a valid email address.";
}

/** Normalise an Indian mobile to its 10 digits (drops +91 / 0 and spacing). */
function normaliseMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export default function NewServiceRequestPage() {
  const t = useTranslations("crmServiceRequestNew");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  // GAP-CRM-SERVICE-REQUESTS-NEW-05: per-field format errors for phone/email.
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  // GAP-CRM-SERVICE-REQUESTS-NEW-04: optionally link an existing contact.
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactLabel, setContactLabel] = useState<string>("");
  const formError = useFormError("service request");
  // GAP-CRM-SERVICE-REQUESTS-NEW-02: load the per-tenant service-type master and
  // fall back to the labelled standard list when none is configured / it fails.
  const [serviceTypes, setServiceTypes] = useState<string[]>(SERVICE_TYPES_FALLBACK);
  const [typesFellBack, setTypesFellBack] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getServiceTypes();
      if (!live) return;
      const { labels, fellBack } = serviceTypeOptions(result);
      setServiceTypes(labels);
      setTypesFellBack(fellBack);
    })();
    return () => {
      live = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    formError.clear();
    setContactError(null);
    setPhoneMsg(null);
    setEmailMsg(null);
    const fd = new FormData(e.currentTarget);
    const citizenPhoneRaw = (fd.get("citizenPhone") as string | null)?.trim() || "";
    const citizenEmailRaw = (fd.get("citizenEmail") as string | null)?.trim() || "";

    // GAP-CRM-SERVICE-REQUESTS-NEW-05: block a clearly-wrong phone/email before
    // the write, with per-field messages.
    const pErr = phoneFormatError(citizenPhoneRaw);
    const eErr = emailFormatError(citizenEmailRaw);
    if (pErr) setPhoneMsg(pErr);
    if (eErr) setEmailMsg(eErr);
    if (pErr || eErr) return;

    // Send the normalised 10-digit mobile (drops +91 / 0 / spacing) so the
    // stored value is consistent; email is sent trimmed.
    const citizenPhone = citizenPhoneRaw ? normaliseMobile(citizenPhoneRaw) : undefined;
    const citizenEmail = citizenEmailRaw || undefined;

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
      // GAP-CRM-SERVICE-REQUESTS-NEW-04: link to an existing CRM contact when
      // one was chosen, so a repeat caller is tied to their record rather than
      // creating an unrelated row. Optional — omitted when none selected.
      ...(contactId ? { contactId } : {}),
      // GAP-CRM-SERVICE-REQUESTS-NEW-03: record how the request was received and,
      // when known, a target resolution date. Both optional; omitted when blank.
      intakeChannel: (fd.get("intakeChannel") as string | null) || undefined,
      dueAt: (() => {
        const d = (fd.get("dueAt") as string | null)?.trim();
        return d ? new Date(`${d}T00:00:00.000Z`).toISOString() : undefined;
      })(),
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
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm/service-requests"
        backLabel={t("backLabel")}
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
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>{t("citizenDetails")}</legend>
            <p role="note" style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 12px" }}>
              {t("dpdpNote")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={LABEL}>
                <span style={{ color: "var(--ink)" }}>
                  {t("fullName")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                </span>
                <input name="citizenName" required maxLength={200} placeholder={t("fullNamePlaceholder")} style={FIELD} />
                {formError.fieldError("citizenName") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("citizenName")}</span>
                )}
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>
                    {t("phone")} <span style={{ color: "var(--ink2)", fontWeight: 400 }}>{t("phoneOrEmailRequired")}</span>
                  </span>
                  <input
                    name="citizenPhone"
                    type="tel"
                    inputMode="tel"
                    maxLength={15}
                    placeholder={t("phonePlaceholder")}
                    style={FIELD}
                    aria-invalid={phoneMsg || contactError ? true : undefined}
                    onChange={() => phoneMsg && setPhoneMsg(null)}
                  />
                  <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("phoneHint")}</span>
                  {phoneMsg && <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{phoneMsg}</span>}
                  {formError.fieldError("citizenPhone") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("citizenPhone")}</span>
                  )}
                </label>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>
                    {t("email")} <span style={{ color: "var(--ink2)", fontWeight: 400 }}>{t("phoneOrEmailRequired")}</span>
                  </span>
                  <input
                    name="citizenEmail"
                    type="email"
                    maxLength={320}
                    placeholder={t("emailPlaceholder")}
                    style={FIELD}
                    aria-invalid={emailMsg || contactError ? true : undefined}
                    onChange={() => emailMsg && setEmailMsg(null)}
                  />
                  {emailMsg && <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{emailMsg}</span>}
                  {formError.fieldError("citizenEmail") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("citizenEmail")}</span>
                  )}
                </label>
              </div>
              {contactError && (
                <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{contactError}</span>
              )}
              {/* GAP-CRM-SERVICE-REQUESTS-NEW-04: optionally link to an existing
                  CRM contact via async server search, so a repeat caller is tied
                  to their record. A "possible existing contact" hint nudges the
                  clerk to link rather than create a duplicate — but linking is
                  never required to log the request. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ color: "var(--ink)", fontSize: 14 }}>
                  {t("linkContact")} <span style={{ color: "var(--ink2)", fontWeight: 400 }}>{t("optional")}</span>
                </span>
                <EntityPicker
                  aria-label={t("linkContactAriaLabel")}
                  value={contactId}
                  onChange={(v) => {
                    const id = typeof v === "string" ? v : null;
                    setContactId(id);
                    if (!id) setContactLabel("");
                  }}
                  search={searchContacts}
                  initialOptions={contactId && contactLabel ? [{ id: contactId, label: contactLabel }] : undefined}
                  placeholder={t("searchContactsPlaceholder")}
                />
                {contactId ? (
                  <span role="note" style={{ fontSize: 12, color: "var(--ink2)" }}>
                    {t("linkedNote")}
                  </span>
                ) : (
                  <span role="note" style={{ fontSize: 12, color: "var(--ink2)" }}>
                    {t("possibleContactNote")}
                  </span>
                )}
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>{t("requestDetails")}</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>
                    {t("serviceType")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                  </span>
                  <select name="serviceType" required style={FIELD}>
                    <option value="">{t("selectServiceType")}</option>
                    {serviceTypes.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {typesFellBack && (
                    <span role="note" style={{ fontSize: 12, color: "var(--ink2)" }}>
                      {t("standardTypesNote")}
                    </span>
                  )}
                  {formError.fieldError("serviceType") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("serviceType")}</span>
                  )}
                </label>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>{t("priority")}</span>
                  <select name="priority" defaultValue="normal" style={FIELD}>
                    <option value="low">{t("priorityLow")}</option>
                    <option value="normal">{t("priorityNormal")}</option>
                    <option value="high">{t("priorityHigh")}</option>
                    <option value="urgent">{t("priorityUrgent")}</option>
                  </select>
                </label>
              </div>
              {/* GAP-CRM-SERVICE-REQUESTS-NEW-03: capture intake channel and an
                  optional target resolution date so a request can be tracked for
                  SLA/channel reporting instead of defaulting to an unknown source. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>{t("receivedVia")}</span>
                  <select name="intakeChannel" defaultValue="" style={FIELD}>
                    <option value="">{t("channelNotSpecified")}</option>
                    <option value="walk_in">{t("channelWalkIn")}</option>
                    <option value="phone">{t("channelPhone")}</option>
                    <option value="portal">{t("channelPortal")}</option>
                    <option value="email">{t("channelEmail")}</option>
                    <option value="letter">{t("channelLetter")}</option>
                  </select>
                </label>
                <label style={LABEL}>
                  <span style={{ color: "var(--ink)" }}>
                    {t("targetDate")} <span style={{ color: "var(--ink2)", fontWeight: 400 }}>{t("optional")}</span>
                  </span>
                  <input name="dueAt" type="date" style={FIELD} />
                </label>
              </div>
              <label style={LABEL}>
                <span style={{ color: "var(--ink)" }}>
                  {t("subject")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
                </span>
                <input name="subject" required maxLength={500} placeholder={t("subjectPlaceholder")} style={FIELD} />
                {formError.fieldError("subject") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subject")}</span>
                )}
              </label>
              <label style={LABEL}>
                <span style={{ color: "var(--ink)" }}>{t("description")}</span>
                <textarea
                  name="description"
                  rows={4}
                  maxLength={5000}
                  placeholder={t("descriptionPlaceholder")}
                  style={{ ...FIELD, resize: "vertical" }}
                />
                {formError.fieldError("description") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
                )}
              </label>
            </div>
          </fieldset>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <a href="/crm/service-requests" className="btn">{t("cancel")}</a>
            <Button type="submit" disabled={saving} loading={saving}>
              {saving ? t("saving") : t("submit")}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
