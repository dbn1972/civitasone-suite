"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, PageHeader } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { todayIST } from "@/lib/formatters";
import { RTI_PUBLIC_AUTHORITIES, normaliseAuthority } from "../rtiAuthorities";

const RTI_SECTIONS = [
  { value: "s.6",  labelKey: "section6" },
  { value: "s.11", labelKey: "section11" },
] as const;

// GAP-CRM-RTI-NEW-02: mode-of-receipt vocabulary mirrors crm-service's
// rti_requests_mode_check constraint (migration 0096).
const RTI_MODES = [
  { value: "online",    labelKey: "modeOnline" },
  { value: "post",      labelKey: "modePost" },
  { value: "email",     labelKey: "modeEmail" },
  { value: "in_person", labelKey: "modeInPerson" },
  { value: "by_hand",   labelKey: "modeByHand" },
] as const;

// GAP-CRM-RTI-NEW-04: the department suggestions come from the shared RTI
// public-authority list (rtiAuthorities), the SAME list the Forward action
// uses, so the two screens can never drift. The typed value is normalised
// (trim + collapse whitespace) before submit so spelling variants fold to one.

// GAP-CRM-RTI-NEW-03: a contact must be either an Indian 10-digit mobile
// (optionally +91 / 0 prefixed) or an email. Validated client-side so a
// typo'd contact is caught before filing; the server remains the authority.
const INDIAN_MOBILE_RE = /^(?:\+?91[-\s]?|0)?[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactError(raw: string, t: (key: string) => string): string | null {
  const value = raw.trim();
  if (!value) return null; // contact is optional
  const normalisedMobile = value.replace(/[-\s]/g, "");
  if (INDIAN_MOBILE_RE.test(normalisedMobile) || EMAIL_RE.test(value)) return null;
  return t("contactInvalid");
}

export default function NewRtiPage() {
  const t = useTranslations("crmRtiNew");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const formError = useFormError("RTI request");
  const [contactMsg, setContactMsg] = useState<string | null>(null);
  const [feeMsg, setFeeMsg] = useState<string | null>(null);
  // GAP-CRM-RTI-NEW-05: Fee Paid? and Fee Amount are coupled. "No" clears and
  // disables the amount; "Yes" requires an amount (0 allowed for exempt/BPL).
  const [feePaid, setFeePaid] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    formError.clear();
    setContactMsg(null);
    setFeeMsg(null);

    const fd = new FormData(e.currentTarget);

    // GAP-CRM-RTI-NEW-03: validate contact format before submit.
    const contactRaw = String(fd.get("applicantContact") ?? "");
    const cErr = contactError(contactRaw, t);
    if (cErr) {
      setContactMsg(cErr);
      return;
    }

    // GAP-CRM-RTI-NEW-05: a fee amount is only meaningful when the fee is paid.
    // When not paid, no amount is sent; when paid, an amount is required (0 is
    // allowed for an exempt/BPL applicant).
    // GAP-CRM-RTI-NEW-01: send the fee as paise (bigint minor units), not a
    // rupees JSON float. rupeesToMinorString rejects >2 decimals rather than
    // silently rounding a statutory fee.
    const feeAmountRaw = feePaid ? feeAmount.trim() : "";
    let feeAmountMinor: string | undefined;
    if (feePaid) {
      if (!feeAmountRaw) {
        setFeeMsg(t("feeRequired"));
        return;
      }
      const minor = rupeesToMinorString(feeAmountRaw, { allowZero: true });
      if (minor === null) {
        setFeeMsg(t("feeInvalid"));
        return;
      }
      feeAmountMinor = minor;
    }

    const receivedDate = String(fd.get("receivedDate") ?? "").trim();
    const mode = String(fd.get("mode") ?? "").trim();

    const body = {
      section:          fd.get("section"),
      // GAP-CRM-RTI-NEW-04: normalise the authority so spelling variants fold.
      departmentRef:    normaliseAuthority(String(fd.get("departmentRef") ?? "")),
      applicantName:    fd.get("applicantName"),
      applicantContact: contactRaw.trim() || undefined,
      subject:          fd.get("subject"),
      description:      fd.get("description"),
      feePaid,
      ...(feeAmountMinor !== undefined ? { feeAmountMinor } : {}),
      ...(receivedDate ? { receivedDate } : {}),
      ...(mode ? { mode } : {}),
    };

    setSaving(true);
    try {
      const res = await fetch("/api/proxy/v1/crm/rti", {
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
      router.push(`/crm/rti/${data.id}`);
    } catch (caught) {
      formError.fromException("save", caught);
      setSaving(false);
    }
  }

  const fieldStyle = {
    padding: "8px 12px",
    border: "1px solid var(--line)",
    borderRadius: "var(--r)",
    background: "var(--bg)",
    color: "var(--ink)",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 4,
    fontSize: 14,
    color: "var(--ink)",
  };

  const req = (
    <span aria-hidden="true" style={{ color: "var(--bad)" }}>
      {" "}*
    </span>
  );

  const today = todayIST();

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm/rti"
        backLabel={t("backLabel")}
      />

      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r)",
          padding: "24px 28px",
          maxWidth: 680,
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

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          {/* ── RTI Metadata ── */}
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>
              {t("rtiDetails")}
            </legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
              >
                <label style={labelStyle}>
                  <span>{t("section")}{req}</span>
                  <select name="section" required style={fieldStyle}>
                    <option value="">{t("selectSection")}</option>
                    {RTI_SECTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {t(s.labelKey)}
                      </option>
                    ))}
                  </select>
                  {formError.fieldError("section") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("section")}</span>
                  )}
                </label>

                <label style={labelStyle}>
                  <span>{t("department")}{req}</span>
                  <input
                    list="dept-suggestions"
                    name="departmentRef"
                    required
                    maxLength={200}
                    placeholder={t("departmentPlaceholder")}
                    style={fieldStyle}
                  />
                  <datalist id="dept-suggestions">
                    {RTI_PUBLIC_AUTHORITIES.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                  {formError.fieldError("departmentRef") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("departmentRef")}</span>
                  )}
                </label>
              </div>

              {/* GAP-CRM-RTI-NEW-02: date & mode of receipt. The 30-day
                  statutory clock runs from the date the request was actually
                  received, not when this register entry is filed. */}
              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
              >
                <label style={labelStyle}>
                  <span>{t("dateOfReceipt")}</span>
                  <input
                    name="receivedDate"
                    type="date"
                    max={today}
                    style={fieldStyle}
                  />
                  <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                    {t("dateOfReceiptHint")}
                  </span>
                  {formError.fieldError("receivedDate") && (
                    <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("receivedDate")}</span>
                  )}
                </label>

                <label style={labelStyle}>
                  <span>{t("modeOfReceipt")}</span>
                  <select name="mode" defaultValue="" style={fieldStyle}>
                    <option value="">{t("selectMode")}</option>
                    {RTI_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {t(m.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label style={labelStyle}>
                <span>{t("subject")}{req}</span>
                <input
                  name="subject"
                  required
                  maxLength={500}
                  placeholder={t("subjectPlaceholder")}
                  style={fieldStyle}
                />
                {formError.fieldError("subject") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subject")}</span>
                )}
              </label>

              <label style={labelStyle}>
                <span>{t("description")}{req}</span>
                <textarea
                  name="description"
                  required
                  rows={5}
                  maxLength={10000}
                  placeholder={t("descriptionPlaceholder")}
                  style={{ ...fieldStyle, resize: "vertical" }}
                />
                {formError.fieldError("description") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
                )}
              </label>
            </div>
          </fieldset>

          {/* ── Applicant Details ── */}
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>
              {t("applicantDetails")}
            </legend>
            {/* GAP-CRM-RTI-NEW-03: DPDP purpose / lawful-basis notice. This is
                an officer-side register entry on behalf of an applicant, so
                the control is a processing notice (not a consent checkbox).
                The exact legal wording is pending DPO/legal sign-off (see
                report). */}
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 12,
                color: "var(--ink2)",
                lineHeight: 1.5,
                padding: "8px 12px",
                background: "color-mix(in srgb, var(--ink2) 6%, transparent)",
                borderRadius: "var(--r)",
              }}
            >
              {t("dpdpNotice")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={labelStyle}>
                <span>{t("fullName")}{req}</span>
                <input
                  name="applicantName"
                  required
                  maxLength={200}
                  placeholder={t("fullNamePlaceholder")}
                  style={fieldStyle}
                />
                {formError.fieldError("applicantName") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("applicantName")}</span>
                )}
              </label>

              <label style={labelStyle}>
                <span>{t("contact")}</span>
                <input
                  name="applicantContact"
                  maxLength={200}
                  placeholder={t("contactPlaceholder")}
                  aria-invalid={contactMsg ? true : undefined}
                  onChange={() => contactMsg && setContactMsg(null)}
                  style={fieldStyle}
                />
                {contactMsg && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{contactMsg}</span>
                )}
              </label>
            </div>
          </fieldset>

          {/* ── Fee ── */}
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>
              {t("applicationFee")}
            </legend>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={labelStyle}>
                <span>{t("feePaid")}</span>
                <select
                  name="feePaid"
                  value={feePaid ? "true" : "false"}
                  onChange={(e) => {
                    const paid = e.target.value === "true";
                    setFeePaid(paid);
                    // Clear a stale amount when switching to "No".
                    if (!paid) {
                      setFeeAmount("");
                      setFeeMsg(null);
                    }
                  }}
                  style={fieldStyle}
                >
                  <option value="false">{t("no")}</option>
                  <option value="true">{t("yes")}</option>
                </select>
              </label>

              <label style={labelStyle}>
                <span>{t("feeAmount")}{feePaid ? req : null}</span>
                <input
                  name="feeAmount"
                  type="text"
                  inputMode="decimal"
                  placeholder={t("feeAmountPlaceholder")}
                  value={feeAmount}
                  disabled={!feePaid}
                  aria-disabled={!feePaid}
                  aria-invalid={feeMsg ? true : undefined}
                  onChange={(e) => {
                    setFeeAmount(e.target.value);
                    if (feeMsg) setFeeMsg(null);
                  }}
                  style={{ ...fieldStyle, ...(feePaid ? {} : { opacity: 0.6, cursor: "not-allowed" }) }}
                />
                {!feePaid ? (
                  <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                    {t("markFeePaid")}
                  </span>
                ) : null}
                {feeMsg && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{feeMsg}</span>
                )}
              </label>
            </div>
          </fieldset>

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <a href="/crm/rti" className="btn">
              {t("cancel")}
            </a>
            <Button type="submit" disabled={saving} loading={saving}>
              {saving ? t("filing") : t("fileRequest")}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
