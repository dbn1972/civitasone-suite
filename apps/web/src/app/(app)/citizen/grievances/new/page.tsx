"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export default function RegisterGrievancePage() {
  const t = useTranslations("grievances");
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("service_delivery");
  const [applicantName, setApplicantName] = useState("");
  const [dpdpConsent, setDpdpConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  /** Client-authored copy for pre-submit validation (field presence, consent gate) — never server text. */
  const [message, setMessage] = useState("");
  const formError = useFormError("grievance");

  const CATEGORIES = [
    { value: "service_delivery", label: "Service Delivery" },
    { value: "corruption", label: "Corruption" },
    { value: "personnel", label: "Personnel" },
    { value: "infrastructure", label: "Infrastructure" },
    { value: "other", label: "Other" },
  ] as const;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !description.trim() || !applicantName.trim()) {
      setStatus("error");
      setMessage("Subject, description and applicant name are required.");
      return;
    }
    if (!dpdpConsent) {
      setStatus("error");
      setMessage("You must consent to data processing under DPDP Act 2023 before submitting.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    formError.clear();
    const body = {
      subject: subject.trim(),
      description: description.trim(),
      category,
      complainantName: applicantName.trim(),
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
      router.push("/citizen/grievances");
      router.refresh();
    } catch {
      setStatus("error");
      formError.fromException("save");
    }
  }

  return (
    <>
      <PageHeader
        title={t("registerFormTitle")}
        subtitle={t("registerFormSubtitle")}
        back="/citizen/grievances"
        backLabel="Grievances"
      />
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="card pad"
        style={{ maxWidth: 820 }}
        noValidate
      >
        <div className="fields">
          <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="applicantName">
              {t("applicantNameLabel")}
            </label>
            <input
              id="applicantName"
              className="inp"
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
              required
              style={{ minHeight: 44 }}
              placeholder={t("applicantNamePlaceholder")}
            />
            {formError.fieldError("complainantName") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("complainantName")}</span>
            )}
          </div>
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="category">
              {t("categoryLabel")}
            </label>
            <select
              id="category"
              className="inp"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              style={{ minHeight: 44 }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {formError.fieldError("category") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("category")}</span>
            )}
          </div>
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="subject">
              {t("subjectLabel")}
            </label>
            <input
              id="subject"
              className="inp"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              style={{ minHeight: 44 }}
              placeholder={t("subjectPlaceholder")}
            />
            {formError.fieldError("subject") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subject")}</span>
            )}
          </div>
          <div
            className="field"
            style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}
          >
            <label className="label" htmlFor="description">
              {t("descriptionLabel")}
            </label>
            <textarea
              id="description"
              className="inp"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder={t("descriptionPlaceholder")}
            />
            {formError.fieldError("description") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
            )}
          </div>
        </div>

        {/* DPDP Act 2023 consent notice */}
        <div
          role="group"
          aria-labelledby="dpdp-notice-heading"
          style={{
            marginTop: 20,
            padding: "14px 16px",
            borderRadius: 8,
            border: "1px solid #d1a700",
            background: "#fffbea",
          }}
        >
          <p
            id="dpdp-notice-heading"
            style={{ margin: "0 0 6px 0", fontWeight: 600, fontSize: "0.875rem", color: "#7a5200" }}
          >
            {t("dpdpNoticeTitle")}
          </p>
          <p style={{ margin: "0 0 10px 0", fontSize: "0.8125rem", color: "#5c4000", lineHeight: 1.5 }}>
            {t.rich("dpdpNoticeBody", {
              section: (chunks) => <strong>{chunks}</strong>,
              days: (chunks) => <strong>{chunks}</strong>,
              email: (chunks) => (
                <a href="mailto:dpo@gov.in" style={{ color: "#7a5200" }}>
                  {chunks}
                </a>
              ),
            })}
          </p>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
              fontSize: "0.875rem",
              color: "#3d2d00",
            }}
          >
            <input
              id="dpdp-consent"
              type="checkbox"
              checked={dpdpConsent}
              onChange={(e) => {
                setDpdpConsent(e.target.checked);
                if (e.target.checked && status === "error") {
                  setMessage("");
                  setStatus("idle");
                }
              }}
              aria-required="true"
              aria-describedby="dpdp-consent-desc"
              style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0, cursor: "pointer" }}
            />
            <span id="dpdp-consent-desc">
              {t.rich("consentCheckboxLabel", { short: (chunks) => <strong>{chunks}</strong> })}
            </span>
          </label>
        </div>

        <div role="status" aria-live="polite">
          {message ? (
            <p
              role={status === "error" ? "alert" : undefined}
              style={{
                marginTop: 12,
                color: status === "error" ? "var(--bad)" : "var(--good)",
                fontSize: "0.875rem",
              }}
            >
              {message}
            </p>
          ) : null}
          {formError.message ? (
            <p role="alert" style={{ marginTop: 12, color: "var(--bad)", fontSize: "0.875rem" }}>
              {formError.message}
            </p>
          ) : null}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button
            type="submit"
            className="btn primary"
            style={{ minHeight: 44 }}
            disabled={!dpdpConsent || status === "submitting"}
            aria-disabled={!dpdpConsent || status === "submitting"}
          >
            {status === "submitting" ? t("submitting") : t("registerButton")}
          </button>
          <Link href="/citizen/grievances" className="btn ghost" style={{ minHeight: 44 }}>
            {t("cancel")}
          </Link>
        </div>
      </form>
    </>
  );
}
