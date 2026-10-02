"use client";

import { useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { CAREERS_ERROR, CAREERS_MUTED, CAREERS_PRIMARY } from "../theme";
import {
  CAREERS_CONSENT_PURPOSE, CAREERS_CONSENT_RETENTION, CAREERS_CONSENT_VERSION,
  careersGrievanceContact, careersPrivacyPolicyUrl,
} from "../consent";
import { FIELD_IDS, firstInvalidId, stipendToMinor, validateApply } from "./applyValidation";

export function ApplyForm({ jobOpeningId, vacancyType = "regular" }: { jobOpeningId: string; vacancyType?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [qualification, setQualification] = useState("");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const localErrors = validateApply({
      vacancyType, name, email, mobile, experience, graduationYear, stipendExpected, availabilityHours, consent,
    });
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      setStatus("error");
      setMessage("Please correct the highlighted fields and submit again.");
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
      qualification: qualification.trim() || undefined,
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
      const res = await fetch("/api/careers/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const dup = await res.clone().json().catch(() => null) as { code?: string; applicationNo?: string | null } | null;
        if (dup?.code === "DUPLICATE_APPLICATION") {
          setStatus("error");
          setMessage(dup.applicationNo ? `You already applied for this vacancy: ${dup.applicationNo}` : "You already applied for this vacancy.");
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
      setMessage("Your application has been received! We'll be in touch at the email you provided.");
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
          <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#15803d" }}>Application received</h3>
          <p style={{ color: "#166534", fontSize: 14, margin: 0 }}>{message}</p>
        </div>
        {applicationId && (
          <div style={{ padding: "14px 24px", background: "#fff", borderTop: "1px solid #bbf7d0", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: CAREERS_MUTED }}>Your reference</p>
            <p style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: CAREERS_PRIMARY, letterSpacing: "0.1em" }}>
              {applicationNo ?? "Reference will be emailed"}
            </p>
            <a href={loginHref} style={{ display: "inline-block", padding: "11px 20px", background: CAREERS_PRIMARY, color: "#fff", borderRadius: 9, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              Track my application →
            </a>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: CAREERS_MUTED }}>Sign in with the email you used to apply.</p>
          </div>
        )}
      </div>
    );
  }

  const fe = (field: string) => errors[field];
  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: 16 }}>
      <Field label="Full name *" id={FIELD_IDS.applicantName!} placeholder="e.g. Priyanka Mohapatra"
        value={name} onChange={setName} required error={fe("applicantName")} autoComplete="name" />
      <Field label="Email *" id={FIELD_IDS.email!} type="email" placeholder="e.g. priyanka@example.com"
        value={email} onChange={setEmail} required error={fe("email")} autoComplete="email" />
      <Field label="Mobile" id={FIELD_IDS.mobile!} type="tel" placeholder="e.g. 9876543210"
        hint="At least 10 digits. Add the country code if the number is not Indian."
        value={mobile} onChange={setMobile} error={fe("mobile")} autoComplete="tel" />
      <Field label="Qualification" id={FIELD_IDS.qualification!} placeholder="e.g. B.Com (Hons), State University"
        value={qualification} onChange={setQualification} error={fe("qualification")} />
      <Field label="Years of experience" id={FIELD_IDS.experienceYears!} type="number" placeholder="e.g. 2"
        hint="Whole years." min="0" step="1"
        value={experience} onChange={setExperience} error={fe("experienceYears")} />
      <Field label="Skills (comma-separated)" id={FIELD_IDS.skills!} placeholder="e.g. MS Excel, Tally, Data Entry"
        value={skills} onChange={setSkills} error={fe("skills")} />

      {/* Internship-specific fields */}
      {vacancyType === "internship" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.05em" }}>Internship details</p>
          <Field label="Institution / College name" id={FIELD_IDS.institutionName!} placeholder="e.g. Government College of Engineering"
            value={institutionName} onChange={setInstitutionName} error={fe("institutionName")} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Current semester / year" id={FIELD_IDS.semester!} placeholder="e.g. 5th Semester"
              value={semester} onChange={setSemester} error={fe("semester")} />
            <Field label="Expected graduation year" id={FIELD_IDS.graduationYear!} type="number" placeholder="e.g. 2026"
              hint="Between 1990 and 2040." min="1990" max="2040" step="1"
              value={graduationYear} onChange={setGraduationYear} error={fe("graduationYear")} />
          </div>
          <Field label="Expected stipend (₹/month, optional)" id={FIELD_IDS.stipendExpectedMinor!} type="number" placeholder="e.g. 15000"
            hint="In rupees per month, up to 2 decimal places." min="0" step="0.01"
            value={stipendExpected} onChange={setStipendExpected} error={fe("stipendExpectedMinor")} />
        </div>
      )}

      {/* Apprenticeship-specific fields */}
      {vacancyType === "apprenticeship" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #86efac" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: "0.05em" }}>Apprenticeship details</p>
          <Field label="Trade category" id={FIELD_IDS.tradeCategory!} placeholder="e.g. Electrician, Fitter, Welder, COPA"
            value={tradeCategory} onChange={setTradeCategory} error={fe("tradeCategory")} />
          <Field label="ITI certificate number (if available)" id={FIELD_IDS.itiCertNo!} placeholder="e.g. ITI/2023/XX/12345"
            value={itiCertNo} onChange={setItiCertNo} error={fe("itiCertNo")} />
        </div>
      )}

      {/* Volunteership-specific fields */}
      {vacancyType === "volunteership" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#ecfeff", borderRadius: 10, border: "1px solid #67e8f9" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#0e7490", textTransform: "uppercase", letterSpacing: "0.05em" }}>Volunteer details</p>
          <Field label="Availability (hours per week)" id={FIELD_IDS.availabilityHoursPerWeek!} type="number" placeholder="e.g. 10"
            hint="Whole hours, 1 to 168." min="1" max="168" step="1"
            value={availabilityHours} onChange={setAvailabilityHours} error={fe("availabilityHoursPerWeek")} />
        </div>
      )}

      {/* DPDP privacy notice + consent (GAP-RECRUITMENT-CAREERS-DETAIL-02) */}
      <fieldset style={{ margin: 0, padding: "14px 16px", border: "1px solid #cbd5e1", borderRadius: 10 }}>
        <legend style={{ padding: "0 6px", fontSize: 13, fontWeight: 700, color: "#334155" }}>Privacy notice</legend>
        <div id="apply-consent-notice" style={{ fontSize: 13, color: "#475569", lineHeight: 1.55, display: "grid", gap: 6 }}>
          <p style={{ margin: 0 }}>{CAREERS_CONSENT_PURPOSE}</p>
          <p style={{ margin: 0 }}>{CAREERS_CONSENT_RETENTION}</p>
          {grievance && <p style={{ margin: 0 }}>Grievance officer: {grievance}</p>}
          {policyUrl && (
            <p style={{ margin: 0 }}>
              <a href={policyUrl} target="_blank" rel="noopener noreferrer" style={{ color: CAREERS_PRIMARY }}>Read the full privacy policy</a>
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
          <span>I have read the privacy notice and consent to my details being processed for this recruitment. *</span>
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
        {status === "submitting" ? "Submitting…" : "Submit application"}
      </button>

      <p style={{ margin: 0, fontSize: 12, color: CAREERS_MUTED }}>
        Your information is sent securely and used only for this recruitment process.
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
