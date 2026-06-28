"use client";

import { useState } from "react";

/**
 * Public application form — no login required. Clean, accessible, mobile-first.
 * Posts to the public /api/v1/careers/apply endpoint. Validates client-side for
 * instant feedback, then server-side on submit.
 */
export function ApplyForm({ jobOpeningId }: { jobOpeningId: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [qualification, setQualification] = useState("");
  const [experience, setExperience] = useState("");
  const [skills, setSkills] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setStatus("error");
      setMessage("Please enter your name and email to apply.");
      return;
    }
    setStatus("submitting");
    setMessage("");

    const body = {
      jobOpeningId,
      applicantName: name.trim(),
      email: email.trim(),
      mobile: mobile.trim() || undefined,
      qualification: qualification.trim() || undefined,
      experienceYears: experience ? Number(experience) : undefined,
      skills: skills.trim() ? skills.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    };

    try {
      const res = await fetch("/api/proxy/v1/careers/apply", {
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
      setStatus("success");
      setMessage("Your application has been received! We'll be in touch at the email you provided.");
    } catch {
      setStatus("error");
      setMessage("We couldn't submit your application. Please check your connection and try again.");
    }
  }

  if (status === "success") {
    return (
      <div style={{ padding: "24px", borderRadius: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", textAlign: "center" }}>
        <p style={{ fontSize: 28, margin: "0 0 8px" }} aria-hidden="true">✅</p>
        <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#15803d" }}>Application received</h3>
        <p style={{ color: "#166534", fontSize: 14, margin: 0 }}>{message}</p>
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
