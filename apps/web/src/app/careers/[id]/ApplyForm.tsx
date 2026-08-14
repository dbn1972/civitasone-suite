"use client";

import { useState } from "react";

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setStatus("error");
      setMessage("Please enter your name and email to apply.");
      return;
    }
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
    };
    // Internship-specific
    if (vacancyType === "internship") {
      if (institutionName.trim()) body.institutionName = institutionName.trim();
      if (graduationYear) body.graduationYear = Number(graduationYear);
      if (semester.trim()) body.semester = semester.trim();
      if (stipendExpected) body.stipendExpectedMinor = Number(stipendExpected) * 100;
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
      if (!res.ok) {
        const text = await res.text();
        let msg = "Something went wrong. Please try again.";
        try { msg = JSON.parse(text)?.message || msg; } catch { /* use default */ }
        setStatus("error");
        setMessage(msg);
        return;
      }
      const data = await res.json() as { id?: string };
      setApplicationId(data.id ?? "");
      setStatus("success");
      setMessage("Your application has been received! We'll be in touch at the email you provided.");
    } catch {
      setStatus("error");
      setMessage("We couldn't submit your application. Please check your connection and try again.");
    }
  }

  if (status === "success") {
    const trackRef = applicationId ? applicationId.slice(-6).toUpperCase() : "";
    const loginHref = `/careers/portal/login${trackRef ? `?ref=APP-${new Date().getFullYear()}-${trackRef}` : ""}`;
    return (
      <div style={{ borderRadius: 12, border: "1px solid #bbf7d0", overflow: "hidden" }}>
        <div style={{ padding: "24px", background: "#f0fdf4", textAlign: "center" }}>
          <p style={{ fontSize: 28, margin: "0 0 8px" }} aria-hidden="true">✅</p>
          <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#15803d" }}>Application received</h3>
          <p style={{ color: "#166534", fontSize: 14, margin: 0 }}>{message}</p>
        </div>
        {applicationId && (
          <div style={{ padding: "14px 24px", background: "#fff", borderTop: "1px solid #bbf7d0", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8" }}>Your reference</p>
            <p style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: "#154089", letterSpacing: "0.1em" }}>
              APP-{new Date().getFullYear()}-{applicationId.slice(-6).toUpperCase()}
            </p>
            <a href={loginHref} style={{ display: "inline-block", padding: "11px 20px", background: "#154089", color: "#fff", borderRadius: 9, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              Track my application →
            </a>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#94a3b8" }}>Sign in with the email you used to apply.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "grid", gap: 16 }}>
      <Field label="Full name *" id="apply-name" placeholder="e.g. Priyanka Mohapatra"
        value={name} onChange={setName} required />
      <Field label="Email *" id="apply-email" type="email" placeholder="e.g. priyanka@example.com"
        value={email} onChange={setEmail} required />
      <Field label="Mobile" id="apply-mobile" type="tel" placeholder="e.g. 9876543210"
        value={mobile} onChange={setMobile} />
      <Field label="Qualification" id="apply-qual" placeholder="e.g. B.Com (Hons), Delhi University"
        value={qualification} onChange={setQualification} />
      <Field label="Years of experience" id="apply-exp" type="number" placeholder="e.g. 2"
        value={experience} onChange={setExperience} />
      <Field label="Skills (comma-separated)" id="apply-skills" placeholder="e.g. MS Excel, Tally, Data Entry"
        value={skills} onChange={setSkills} />

      {/* Internship-specific fields */}
      {vacancyType === "internship" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.05em" }}>Internship details</p>
          <Field label="Institution / College name" id="apply-inst" placeholder="e.g. IIT Delhi, SRCC, Delhi University"
            value={institutionName} onChange={setInstitutionName} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Current semester / year" id="apply-sem" placeholder="e.g. 5th Semester"
              value={semester} onChange={setSemester} />
            <Field label="Expected graduation year" id="apply-gradyr" type="number" placeholder="e.g. 2026"
              value={graduationYear} onChange={setGraduationYear} />
          </div>
          <Field label="Expected stipend (₹/month, optional)" id="apply-stipend" type="number" placeholder="e.g. 15000"
            value={stipendExpected} onChange={setStipendExpected} />
        </div>
      )}

      {/* Apprenticeship-specific fields */}
      {vacancyType === "apprenticeship" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #86efac" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: "0.05em" }}>Apprenticeship details</p>
          <Field label="Trade category" id="apply-trade" placeholder="e.g. Electrician, Fitter, Welder, COPA"
            value={tradeCategory} onChange={setTradeCategory} />
          <Field label="ITI certificate number (if available)" id="apply-iti" placeholder="e.g. ITI/2023/DL/12345"
            value={itiCertNo} onChange={setItiCertNo} />
        </div>
      )}

      {/* Volunteership-specific fields */}
      {vacancyType === "volunteership" && (
        <div style={{ display: "grid", gap: 16, padding: "16px", background: "#ecfeff", borderRadius: 10, border: "1px solid #67e8f9" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#0e7490", textTransform: "uppercase", letterSpacing: "0.05em" }}>Volunteer details</p>
          <Field label="Availability (hours per week)" id="apply-hrs" type="number" placeholder="e.g. 10"
            value={availabilityHours} onChange={setAvailabilityHours} />
        </div>
      )}

      {status === "error" && (
        <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 13, border: "1px solid #fecaca" }}>
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        style={{
          padding: "14px 24px", fontSize: 15, fontWeight: 700, color: "#fff",
          background: status === "submitting" ? "#94a3b8" : "#4f46e5",
          border: "none", borderRadius: 10, cursor: status === "submitting" ? "wait" : "pointer",
          minHeight: 48, transition: "background 0.15s",
        }}
      >
        {status === "submitting" ? "Submitting…" : "Submit application"}
      </button>

      <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
        Your information is sent securely and used only for this recruitment process.
      </p>
    </form>
  );
}

function Field({ label, id, type = "text", placeholder, value, onChange, required }: {
  label: string; id: string; type?: string; placeholder: string;
  value: string; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
        {label}
      </label>
      <input
        id={id} type={type} placeholder={placeholder} required={required}
        value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "11px 14px", fontSize: 14, border: "1px solid #cbd5e1",
          borderRadius: 9, boxSizing: "border-box", color: "#0f172a", background: "#fff",
        }}
      />
    </div>
  );
}
