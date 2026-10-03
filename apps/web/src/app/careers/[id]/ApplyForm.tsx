"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { CAREERS_ERROR, CAREERS_MUTED, CAREERS_PRIMARY } from "../theme";
import {
  CAREERS_CONSENT_PURPOSE, CAREERS_CONSENT_RETENTION, CAREERS_CONSENT_VERSION,
  careersGrievanceContact, careersPrivacyPolicyUrl,
} from "../consent";
import {
  CATEGORY_VALUES, FIELD_IDS, QUALIFICATION_LEVELS, RESUME_ACCEPT, composeQualification, firstInvalidId,
  stipendToMinor, validateApply, validateResume, type ApplyMessageKey,
} from "./applyValidation";

export function ApplyForm({ jobOpeningId, vacancyType = "regular" }: { jobOpeningId: string; vacancyType?: string }) {
  const t = useTranslations("careersApply");
  // Validation messages share the form's language (GAP-RECRUITMENT-CAREERS-HOME-07).
  const msg = (key: ApplyMessageKey): string => t(`err_${key}`);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [qualLevel, setQualLevel] = useState("");
  const [qualDetail, setQualDetail] = useState("");
  const [category, setCategory] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [experience, setExperience] = useState("");
  const [skills, setSkills] = useState("");
  // Type-specific
  const [institutionName, setInstitutionName] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [semester, setSemester] = useState("");
  const [stipendExpected, setStipendExpected] = useState("");
  const [tradeCategory, setTradeCategory] = useState("");
  const [itiCertNo, setItiCertNo] = useState("");
  const [availabilityHours, setAvailabilityHours] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [applicationId, setApplicationId] = useState("");
  // Real, server-assigned reference (hrms_applications.application_no). Never derived client-side.
  const [applicationNo, setApplicationNo] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  // Inline per-field messages, keyed by the backend's field names (local checks and server fieldErrors share keys).
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const grievance = careersGrievanceContact();
  const policyUrl = careersPrivacyPolicyUrl();
  // HIGH fix: this form used to read the raw error envelope's `.message`
  // directly (JSON.parse(text)?.message), so a failed Zod validation showed
  // the backend's generic "invalid request" instead of anything actionable —
  // every other form in this codebase goes through useFormError specifically
  // to prevent that. Matching that established pattern here too.
  const formError = useFormError("application");

  async function uploadResume(file: File): Promise<{ ok: true; resumeKey: string } | { ok: false; message: string }> {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("jobOpeningId", jobOpeningId);
    try {
      const res = await fetch("/api/careers/resume", { method: "POST", body: fd });
      if (!res.ok) {
        const env = await res.json().catch(() => null) as { code?: string } | null;
        return { ok: false, message: env?.code === "MALWARE_DETECTED" ? t("resumeInfected") : env?.code === "SCAN_UNAVAILABLE" ? t("resumeScanUnavailable") : res.status === 413 ? t("err_resumeSize") : env?.code === "INVALID_RESUME" ? t("resumeInvalid") : t("resumeUploadFailed") };
      }
      const j = await res.json() as { resumeKey?: string };
      return j.resumeKey ? { ok: true, resumeKey: j.resumeKey } : { ok: false, message: t("resumeUploadFailed") };
    } catch {
      return { ok: false, message: t("resumeUploadFailed") };
    }
  }

  function chooseResume(file: File | null) {
    setResumeFile(file);
    if (!file) { setErrors((e) => ({ ...e, resume: undefined })); return; }
    const problem = validateResume({ name: file.name, size: file.size, type: file.type }, msg);
    setErrors((e) => ({ ...e, resume: problem ?? undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const localErrors = validateApply({
      vacancyType, name, email, mobile, experience, graduationYear, stipendExpected, availabilityHours, consent,
      category, dateOfBirth,
      resume: resumeFile ? { name: resumeFile.name, size: resumeFile.size, type: resumeFile.type } : null,
    }, msg);
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      setStatus("error");
      setMessage(t("fixErrors"));
      const id = firstInvalidId(localErrors);
      if (id && typeof document !== "undefined") document.getElementById(id)?.focus();
      return;
    }
    setErrors({});
    setStatus("submitting");
    setMessage("");

    const body: Record<string, unknown> = {
      jobOpeningId,
      applicantName: name.trim(),
      email: email.trim(),
      mobile: mobile.trim() || undefined,
      qualification: composeQualification(qualLevel, qualDetail),
      // Optional self-declared claims (GAP-RECRUITMENT-CAREERS-DETAIL-03): HR verifies them against certificates.
      category: category || undefined,
      dateOfBirth: dateOfBirth || undefined,
      experienceYears: experience ? Number(experience) : undefined,
      skills: skills.trim() ? skills.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      // DPDP: the server rejects a submission without this and stores timestamp + notice version.
      consent: true,
      consentVersion: CAREERS_CONSENT_VERSION,
    };
    // Internship-specific
    if (vacancyType === "internship") {
      if (institutionName.trim()) body.institutionName = institutionName.trim();
      if (graduationYear) body.graduationYear = Number(graduationYear);
      if (semester.trim()) body.semester = semester.trim();
      if (stipendExpected.trim()) {
        // Exact rupees -> paise (string parse, no float multiply); validated above.
        const s = stipendToMinor(stipendExpected);
        if (s.ok) body.stipendExpectedMinor = s.minor;
      }
    }
    // Apprenticeship-specific
    if (vacancyType === "apprenticeship") {
      if (tradeCategory.trim()) body.tradeCategory = tradeCategory.trim();
      if (itiCertNo.trim()) body.itiCertNo = itiCertNo.trim();
    }
    // Volunteership-specific
    if (vacancyType === "volunteership") {
      if (availabilityHours) body.availabilityHoursPerWeek = Number(availabilityHours);
    }

    try {
      // GAP-RECRUITMENT-CAREERS-DETAIL-04: upload the resume first; the application then carries only its key.
      if (resumeFile) {
        const up = await uploadResume(resumeFile);
        if (!up.ok) {
          setStatus("error");
          setMessage(up.message);
          setErrors({ resume: up.message });
          document.getElementById(FIELD_IDS.resume!)?.focus();
          return;
        }
        body.resumeKey = up.resumeKey;
      }
      const res = await fetch("/api/careers/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const dup = await res.clone().json().catch(() => null) as { code?: string; applicationNo?: string | null } | null;
        if (dup?.code === "DUPLICATE_APPLICATION") {
          setStatus("error");
          setMessage(dup.applicationNo ? t("duplicateWithNo", { no: dup.applicationNo }) : t("duplicate"));
          return;
        }
      }
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus("error");
        setMessage(resolved.message);
        // Backend per-field validation messages go under their inputs.
        setErrors(resolved.fieldErrors);
        const id = firstInvalidId(resolved.fieldErrors);
        if (id && typeof document !== "undefined") document.getElementById(id)?.focus();
        return;
      }
      const data = await res.json() as { id?: string; applicationNo?: string | null };
      setApplicationId(data.id ?? "");
      setApplicationNo(data.applicationNo ?? null);
      setStatus("success");
      setMessage(t("received"));
    } catch {
      setStatus("error");
      setMessage(formError.fromException("save").message);
    }
  }

  if (status === "success") {
    const loginHref = `/careers/portal/login${applicationNo ? `?ref=${encodeURIComponent(applicationNo)}` : ""}`;
    return (
      <div style={{ borderRadius: 12, border: "1px solid #bbf7d0", overflow: "hidden" }}>
        <div style={{ padding: "24px", background: "#f0fdf4", textAlign: "center" }}>
          <p style={{ fontSize: 28, margin: "0 0 8px" }} aria-hidden="true">✅</p>
          <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#15803d" }}>{t("receivedTitle")}</h3>
          <p style={{ color: "#166534", fontSize: 14, margin: 0 }}>{message}</p>
        </div>
        {applicationId && (
          <div style={{ padding: "14px 24px", background: "#fff", borderTop: "1px solid #bbf7d0", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: CAREERS_MUTED }}>{t("yourReference")}</p>
            <p style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: CAREERS_PRIMARY, letterSpacing: "0.1em" }}>
              {applicationNo ?? t("referenceEmailed")}
            </p>
            <a href={loginHref} style={{ display: "inline-block", padding: "11px 20px", background: CAREERS_PRIMARY, color: "#fff", borderRadius: 9, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              {t("trackMyApplication")} →
            </a>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: CAREERS_MUTED }}>{t("signInHint")}</p>
          </div>
        )}
      </div>
    );
  }

  const fe = (field: string) => errors[field];
  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: 16 }}>
      <Field label={t("fullName")} id={FIELD_IDS.applicantName!} placeholder={t("phName")}
        value={name} onChange={setName} required error={fe("applicantName")} autoComplete="name" />
      <Field label={t("email")} id={FIELD_IDS.email!} type="email" placeholder={t("phEmail")}
        value={email} onChange={setEmail} required error={fe("email")} autoComplete="email" />
      <Field label={t("mobile")} id={FIELD_IDS.mobile!} type="tel" placeholder={t("phMobile")}
        hint={t("mobileHint")}
        value={mobile} onChange={setMobile} error={fe("mobile")} autoComplete="tel" />
      <Field label={t("dob")} id={FIELD_IDS.dateOfBirth!} type="date" placeholder=""
        hint={t("dobHint")} max={new Date().toISOString().slice(0, 10)}
        value={dateOfBirth} onChange={setDateOfBirth} error={fe("dateOfBirth")} autoComplete="bday" />
      <SelectField label={t("category")} id={FIELD_IDS.category!} hint={t("categoryHint")} value={category} onChange={setCategory} error={fe("category")}
        options={[{ value: "", label: t("category_none") }, ...CATEGORY_VALUES.map((c) => ({ value: c, label: t(`category_${c}`) }))]} />
      <SelectField label={t("qualLevel")} id="apply-qual-level" value={qualLevel} onChange={setQualLevel}
        options={[{ value: "", label: t("qualLevelPlaceholder") }, ...QUALIFICATION_LEVELS.map((l) => ({ value: l, label: t(`qualLevel_${l}`) }))]} />
      <Field label={t("qualDetail")} id={FIELD_IDS.qualification!} placeholder={t("phQualDetail")}
        value={qualDetail} onChange={setQualDetail} error={fe("qualification")} />
      <Field label={t("experience")} id={FIELD_IDS.experienceYears!} type="number" placeholder={t("phExperience")}
        hint={t("experienceHint")} min="0" step="1"
        value={experience} onChange={setExperience} error={fe("experienceYears")} />
      <Field label={t("skills")} id={FIELD_IDS.skills!} placeholder={t("phSkills")}
        value={skills} onChange={setSkills} error={fe("skills")} />
      <div>
        <label htmlFor={FIELD_IDS.resume} style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>{t("resume")}</label>
        <input
          id={FIELD_IDS.resume} type="file" accept={RESUME_ACCEPT}
          onChange={(e) => chooseResume(e.target.files?.[0] ?? null)}
          aria-invalid={fe("resume") ? true : undefined}
          aria-describedby={`${FIELD_IDS.resume}-hint${fe("resume") ? ` ${FIELD_IDS.resume}-error` : ""}`}
          style={{ width: "100%", fontSize: 14 }}
        />
        <p id={`${FIELD_IDS.resume}-hint`} style={{ margin: "4px 0 0", fontSize: 12, color: CAREERS_MUTED }}>
          {resumeFile ? t("resumeSelected", { name: resumeFile.name }) : t("resumeHint")}
        </p>
        {fe("resume") && <p id={`${FIELD_IDS.resume}-error`} style={{ margin: "4px 0 0", fontSize: 12, color: CAREERS_ERROR, fontWeight: 600 }}>{fe("resume")}</p>}
      </div>

      {/* Internship-specific fields */}
      {vacancyType === "internship" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("internshipDetails")}</p>
          <Field label={t("institution")} id={FIELD_IDS.institutionName!} placeholder={t("phInstitution")}
            value={institutionName} onChange={setInstitutionName} error={fe("institutionName")} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={t("semester")} id={FIELD_IDS.semester!} placeholder={t("phSemester")}
              value={semester} onChange={setSemester} error={fe("semester")} />
            <Field label={t("gradYear")} id={FIELD_IDS.graduationYear!} type="number" placeholder={t("phGradYear")}
              hint={t("gradYearHint")} min="1990" max="2040" step="1"
              value={graduationYear} onChange={setGraduationYear} error={fe("graduationYear")} />
          </div>
          <Field label={t("stipend")} id={FIELD_IDS.stipendExpectedMinor!} type="number" placeholder={t("phStipend")}
            hint={t("stipendHint")} min="0" step="0.01"
            value={stipendExpected} onChange={setStipendExpected} error={fe("stipendExpectedMinor")} />
        </div>
      )}

      {/* Apprenticeship-specific fields */}
      {vacancyType === "apprenticeship" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #86efac" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("apprenticeshipDetails")}</p>
          <Field label={t("trade")} id={FIELD_IDS.tradeCategory!} placeholder={t("phTrade")}
            value={tradeCategory} onChange={setTradeCategory} error={fe("tradeCategory")} />
          <Field label={t("iti")} id={FIELD_IDS.itiCertNo!} placeholder={t("phIti")}
            value={itiCertNo} onChange={setItiCertNo} error={fe("itiCertNo")} />
        </div>
      )}

      {/* Volunteership-specific fields */}
      {vacancyType === "volunteership" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#ecfeff", borderRadius: 10, border: "1px solid #67e8f9" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#0e7490", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("volunteerDetails")}</p>
          <Field label={t("hours")} id={FIELD_IDS.availabilityHoursPerWeek!} type="number" placeholder={t("phHours")}
            hint={t("hoursHint")} min="1" max="168" step="1"
            value={availabilityHours} onChange={setAvailabilityHours} error={fe("availabilityHoursPerWeek")} />
        </div>
      )}

      {/* DPDP privacy notice + consent (GAP-RECRUITMENT-CAREERS-DETAIL-02) */}
      <fieldset style={{ margin: 0, padding: "14px 16px", border: "1px solid #cbd5e1", borderRadius: 10 }}>
        <legend style={{ padding: "0 6px", fontSize: 13, fontWeight: 700, color: "#334155" }}>{t("privacyNotice")}</legend>
        <div id="apply-consent-notice" style={{ fontSize: 13, color: "#475569", lineHeight: 1.55, display: "grid", gap: 6 }}>
          <p style={{ margin: 0 }}>{CAREERS_CONSENT_PURPOSE}</p>
          <p style={{ margin: 0 }}>{CAREERS_CONSENT_RETENTION}</p>
          {grievance && <p style={{ margin: 0 }}>{t("grievance", { contact: grievance })}</p>}
          {policyUrl && (
            <p style={{ margin: 0 }}>
              <a href={policyUrl} target="_blank" rel="noopener noreferrer" style={{ color: CAREERS_PRIMARY }}>{t("readPolicy")}</a>
            </p>
          )}
        </div>
        <label htmlFor={FIELD_IDS.consent} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, fontSize: 14, color: "#0f172a", fontWeight: 600, cursor: "pointer" }}>
          <input
            id={FIELD_IDS.consent} type="checkbox" checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-required="true" aria-invalid={fe("consent") ? true : undefined}
            aria-describedby={`apply-consent-notice${fe("consent") ? " apply-consent-error" : ""}`}
            style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }}
          />
          <span>{t("consentLabel")}</span>
        </label>
        {fe("consent") && (
          <p id="apply-consent-error" role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: CAREERS_ERROR, fontWeight: 600 }}>
            {fe("consent")}
          </p>
        )}
      </fieldset>

      {status === "error" && (
        <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: CAREERS_ERROR, fontSize: 13, border: "1px solid #fecaca" }}>
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        style={{
          padding: "14px 24px", fontSize: 15, fontWeight: 700, color: "#fff",
          background: status === "submitting" ? CAREERS_MUTED : CAREERS_PRIMARY,
          border: "none", borderRadius: 10, cursor: status === "submitting" ? "wait" : "pointer",
          minHeight: 48, transition: "background 0.15s",
        }}
      >
        {status === "submitting" ? t("submitting") : t("submit")}
      </button>

      <p style={{ margin: 0, fontSize: 12, color: CAREERS_MUTED }}>
        {t("secureNote")}
      </p>
    </form>
  );
}

function Field({ label, id, type = "text", placeholder, value, onChange, required, hint, error, min, max, step, autoComplete }: {
  label: string; id: string; type?: string; placeholder: string;
  value: string; onChange: (v: string) => void; required?: boolean;
  hint?: string; error?: string; min?: string; max?: string; step?: string; autoComplete?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
        {label}
      </label>
      <input
        id={id} type={type} placeholder={placeholder} required={required}
        min={min} max={max} step={step} autoComplete={autoComplete}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "11px 14px", fontSize: 14, border: `1px solid ${error ? CAREERS_ERROR : "#cbd5e1"}`,
          borderRadius: 9, boxSizing: "border-box", color: "#0f172a", background: "#fff",
        }}
      />
      {hint && <p id={hintId} style={{ margin: "4px 0 0", fontSize: 12, color: CAREERS_MUTED }}>{hint}</p>}
      {error && <p id={errorId} style={{ margin: "4px 0 0", fontSize: 12, color: CAREERS_ERROR, fontWeight: 600 }}>{error}</p>}
    </div>
  );
}

function SelectField({ label, id, value, onChange, options, hint, error }: {
  label: string; id: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; hint?: string; error?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>{label}</label>
      <select
        id={id} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        style={{ width: "100%", padding: "11px 14px", fontSize: 14, border: `1px solid ${error ? CAREERS_ERROR : "#cbd5e1"}`, borderRadius: 9, boxSizing: "border-box", color: "#0f172a", background: "#fff" }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p id={hintId} style={{ margin: "4px 0 0", fontSize: 12, color: CAREERS_MUTED }}>{hint}</p>}
      {error && <p id={errorId} style={{ margin: "4px 0 0", fontSize: 12, color: CAREERS_ERROR, fontWeight: 600 }}>{error}</p>}
    </div>
  );
}
