"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader, Button } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { getDpoEmail } from "@/lib/orgConfig";

const DPDP_NOTICE_VERSION = "2023.1";

interface Ack { id: string; grievanceNo: string; /** true when the service issued the number; false = id-derived tracking reference only */ issued: boolean }

export default function RegisterGrievancePage() {
  const t = useTranslations("grievances");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("service_delivery");
  // GAP-CITIZEN-GRIEVANCES-NEW-02: "filing on behalf of a citizen" mode. When on,
  // the officer records a complainant contact and the server marks the grievance
  // filed-on-behalf (attributing the officer as the filing actor).
  const [onBehalf, setOnBehalf] = useState(false);
  const [applicantName, setApplicantName] = useState("");
  const [contactMobile, setContactMobile] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [dpdpConsent, setDpdpConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [ack, setAck] = useState<Ack | null>(null);
  const [copied, setCopied] = useState(false);
  const formError = useFormError("grievance");

  const dpoEmail = getDpoEmail();

  // GAP-CITIZEN-GRIEVANCES-NEW-05: category labels come from i18n, not hard-coded English.
  const CATEGORIES = [
    { value: "service_delivery", label: t("catServiceDelivery") },
    { value: "corruption", label: t("catCorruption") },
    { value: "personnel", label: t("catPersonnel") },
    { value: "infrastructure", label: t("catInfrastructure") },
    { value: "other", label: t("catOther") },
  ] as const;

  function resetForAnother() {
    setSubject(""); setDescription(""); setCategory("service_delivery");
    setOnBehalf(false);
    setApplicantName(""); setContactMobile(""); setContactEmail("");
    setDpdpConsent(false); setStatus("idle"); setMessage(""); setAck(null); setCopied(false);
    formError.clear();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !description.trim() || !applicantName.trim()) {
      setStatus("error");
      setMessage(t("validationRequiredFields"));
      return;
    }
    if (!dpdpConsent) {
      setStatus("error");
      setMessage(t("validationConsentRequired"));
      return;
    }
    // GAP-CITIZEN-GRIEVANCES-NEW-02: on-behalf filing must carry a contact so the
    // complainant is reachable.
    if (onBehalf && !contactMobile.trim() && !contactEmail.trim()) {
      setStatus("error");
      setMessage(t("validationOnBehalfContactRequired"));
      return;
    }
    setStatus("submitting");
    setMessage("");
    formError.clear();
    const contact = [
      contactMobile.trim() ? { kind: "mobile", value: contactMobile.trim() } : null,
      contactEmail.trim() ? { kind: "email", value: contactEmail.trim() } : null,
    ].filter(Boolean);
    const body = {
      subject: subject.trim(),
      description: description.trim(),
      category,
      complainantName: applicantName.trim(),
      // GAP-CITIZEN-GRIEVANCES-NEW-02: optional complainant contact.
      complainantContact: contact.length > 0 ? contact : undefined,
      // GAP-CITIZEN-GRIEVANCES-NEW-02: officer filing-on-behalf flag.
      filedOnBehalf: onBehalf,
      // GAP-CITIZEN-GRIEVANCES-NEW-01: structured DPDP consent record (server timestamps it).
      dpdpConsent: { given: true, noticeVersion: DPDP_NOTICE_VERSION, purpose: "grievance_redressal" },
    };
    try {
      const res = await fetch("/api/proxy/v1/citizen/grievances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        await formError.fromResponse(res, "save");
        return;
      }
      // GAP-CITIZEN-GRIEVANCES-NEW-03: show the grievance number before leaving.
      const payload = (await res.json().catch(() => null)) as
        | { id?: string; grievanceNo?: string; data?: { id?: string; grievanceNo?: string } }
        | null;
      const id = payload?.id ?? payload?.data?.id ?? "";
      const issuedNo = payload?.grievanceNo ?? payload?.data?.grievanceNo ?? "";
      // Fallback is a tracking reference derived from the id, NOT a statutory grievance number.
      const grievanceNo = issuedNo || (id ? `GRV-${id.slice(0, 8).toUpperCase()}` : "");
      setStatus("idle");
      setAck({ id, grievanceNo, issued: Boolean(issuedNo) });
    } catch (caught) {
      setStatus("error");
      formError.fromException("save", caught);
    }
  }

  if (ack) {
    return (
      <>
        <PageHeader title={t("ackTitle")} back="/citizen/grievances" backLabel="Grievances" />
        <div className="card pad" style={{ maxWidth: 620 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 4px" }}>{ack.issued ? t("ackNumberLabel") : t("ackReferenceLabel")}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ fontSize: 22, letterSpacing: 0.5 }}>{ack.grievanceNo}</strong>
            <Button
              type="button"
              variant="ghost"
              style={{ minHeight: 36 }}
              onClick={() => {
                void navigator.clipboard?.writeText(ack.grievanceNo).then(() => setCopied(true)).catch(() => undefined);
              }}
            >
              {copied ? t("ackCopied") : t("ackCopy")}
            </Button>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            {ack.id ? (
              <Link href={`/citizen/requests/${ack.id}`} className="btn primary" style={{ minHeight: 44 }}>
                {t("ackView")}
              </Link>
            ) : null}
            <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={resetForAnother}>
              {t("ackRegisterAnother")}
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("registerFormTitle")}
        subtitle={t("registerFormSubtitle")}
        back="/citizen/grievances"
        backLabel="Grievances"
      />
      <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
        <div className="fields">
          {/* GAP-CITIZEN-GRIEVANCES-NEW-02: filing-on-behalf mode selector. */}
          <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: "0.875rem" }}>
              <input
                id="file-on-behalf"
                type="checkbox"
                checked={onBehalf}
                onChange={(e) => setOnBehalf(e.target.checked)}
                style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
              />
              <span>{t("onBehalfLabel")}</span>
            </label>
            {onBehalf ? <p style={{ margin: "6px 0 0 28px", fontSize: 12, color: "var(--muted)" }}>{t("onBehalfHint")}</p> : null}
          </div>

          <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="applicantName">
              {t("applicantNameLabel")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
              <span className="sr-only"> {t("requiredIndicator")}</span>
            </label>
            <input id="applicantName" className="inp" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} required style={{ minHeight: 44 }} placeholder={t("applicantNamePlaceholder")} />
            {formError.fieldError("complainantName") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("complainantName")}</span>
            )}
          </div>

          {/* GAP-CITIZEN-GRIEVANCES-NEW-02/04: optional contact fields. */}
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="contactMobile">{t("contactMobileLabel")}</label>
            <input id="contactMobile" className="inp" inputMode="numeric" value={contactMobile} onChange={(e) => setContactMobile(e.target.value)} style={{ minHeight: 44 }} placeholder={t("contactMobilePlaceholder")} />
          </div>
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="contactEmail">{t("contactEmailLabel")}</label>
            <input id="contactEmail" className="inp" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} style={{ minHeight: 44 }} placeholder={t("contactEmailPlaceholder")} />
          </div>

          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="category">{t("categoryLabel")}</label>
            <select id="category" className="inp" value={category} onChange={(e) => setCategory(e.target.value)} required style={{ minHeight: 44 }}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="subject">
              {t("subjectLabel")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
            </label>
            <input id="subject" className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} required style={{ minHeight: 44 }} placeholder={t("subjectPlaceholder")} />
            {formError.fieldError("subject") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subject")}</span>
            )}
          </div>
          <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="description">
              {t("descriptionLabel")} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
            </label>
            <textarea id="description" className="inp" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} required placeholder={t("descriptionPlaceholder")} />
            {formError.fieldError("description") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
            )}
          </div>
        </div>

        {/* DPDP Act 2023 consent notice */}
        <div role="group" aria-labelledby="dpdp-notice-heading" style={{ marginTop: 20, padding: "14px 16px", borderRadius: 8, border: "1px solid #d1a700", background: "#fffbea" }}>
          <p id="dpdp-notice-heading" style={{ margin: "0 0 6px 0", fontWeight: 600, fontSize: "0.875rem", color: "#7a5200" }}>
            {t("dpdpNoticeTitle")}
          </p>
          <p style={{ margin: "0 0 10px 0", fontSize: "0.8125rem", color: "#5c4000", lineHeight: 1.5 }}>
            {t.rich("dpdpNoticeBody", {
              section: (chunks) => <strong>{chunks}</strong>,
              days: (chunks) => <strong>{chunks}</strong>,
            })}{" "}
            <a href={`mailto:${dpoEmail}`} style={{ color: "#7a5200", textDecoration: "underline" }}>{dpoEmail}</a>.
          </p>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: "0.875rem", color: "#3d2d00" }}>
            <input
              id="dpdp-consent"
              type="checkbox"
              checked={dpdpConsent}
              onChange={(e) => {
                setDpdpConsent(e.target.checked);
                if (e.target.checked && status === "error") { setMessage(""); setStatus("idle"); }
              }}
              aria-required="true"
              aria-describedby="dpdp-consent-desc"
              style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0, cursor: "pointer" }}
            />
            <span id="dpdp-consent-desc">
              {t.rich("consentCheckboxLabel", { short: (chunks) => <strong>{chunks}</strong> })}{" "}
              <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
            </span>
          </label>
        </div>

        <div role="status" aria-live="polite">
          {message ? (
            <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
              {message}
            </p>
          ) : null}
          {formError.message ? (
            <p role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: "0.875rem" }}>{formError.message}</p>
          ) : null}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={!dpdpConsent || status === "submitting"} aria-disabled={!dpdpConsent || status === "submitting"}>
            {status === "submitting" ? t("submitting") : t("registerButton")}
          </Button>
          <Link href="/citizen/grievances" className="btn ghost" style={{ minHeight: 44 }}>{t("cancel")}</Link>
        </div>
      </form>
    </>
  );
}
