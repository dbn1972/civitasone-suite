"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "../../../../_components/ds";

const CATEGORIES = [
  { value: "service_delivery", label: "Service Delivery" },
  { value: "corruption", label: "Corruption" },
  { value: "personnel", label: "Personnel" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "other", label: "Other" },
] as const;

export default function RegisterGrievancePage() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("service_delivery");
  const [applicantName, setApplicantName] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !description.trim() || !applicantName.trim()) {
      setStatus("error");
      setMessage("Subject, description and applicant name are required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
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
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      router.push("/citizen/grievances");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <>
      <PageHeader
        title="Register Grievance"
        subtitle="File a new grievance under the CPGRAMS-style system. Response within 30 days."
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
              Applicant name *
            </label>
            <input
              id="applicantName"
              className="inp"
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
              required
              style={{ minHeight: 44 }}
              placeholder="Full name of the complainant"
            />
          </div>
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="category">
              Category *
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
          </div>
          <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
            <label className="label" htmlFor="subject">
              Subject *
            </label>
            <input
              id="subject"
              className="inp"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              style={{ minHeight: 44 }}
              placeholder="Brief description of the grievance"
            />
          </div>
          <div
            className="field"
            style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}
          >
            <label className="label" htmlFor="description">
              Description *
            </label>
            <textarea
              id="description"
              className="inp"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="Provide full details of the grievance, including dates and parties involved."
            />
          </div>
        </div>

        <div role="status" aria-live="polite">
          {message ? (
            <p
              role={status === "error" ? "alert" : undefined}
              style={{
                marginTop: 12,
                color: status === "error" ? "#b91c1c" : "#047857",
                fontSize: "0.875rem",
              }}
            >
              {message}
            </p>
          ) : null}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button
            type="submit"
            className="btn primary"
            style={{ minHeight: 44 }}
            disabled={status === "submitting"}
          >
            {status === "submitting" ? "Submitting…" : "Register grievance"}
          </button>
          <Link href="/citizen/grievances" className="btn ghost" style={{ minHeight: 44 }}>
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
