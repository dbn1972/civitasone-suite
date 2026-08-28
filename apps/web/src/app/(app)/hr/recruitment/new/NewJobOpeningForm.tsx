"use client";

import { useId, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink2)",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1.5px solid var(--line)",
  borderRadius: "var(--r-sm)",
  background: "var(--panel)",
  color: "var(--ink)",
  minHeight: 44,
};

const inputInvalidStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "var(--bad)",
};

export function NewJobOpeningForm() {
  const searchParams = useSearchParams();
  const templateId = searchParams.get("templateId");

  const [refNo, setRefNo] = useState("");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [vacancies, setVacancies] = useState(1);
  const [vacancyType, setVacancyType] = useState("regular");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/jd-templates/${templateId}`, {
          headers: { "content-type": "application/json" },
        });
        if (!res.ok) return;
        const tmpl = await res.json() as { name?: string; vacancyType?: string; description?: string; qualification?: string; payRange?: string };
        if (tmpl.name) { setTitle(tmpl.name); setTemplateName(tmpl.name); }
        if (tmpl.vacancyType) setVacancyType(tmpl.vacancyType);
        if (tmpl.description) setDescription(tmpl.description);
      } catch { /* ignore */ }
    })();
  }, [templateId]);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState<string | null>(null);

  const refNoId = useId();
  const titleId = useId();
  const deptId = useId();
  const vacanciesId = useId();
  const descId = useId();
  const closesAtId = useId();
  const statusMsgId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!refNo.trim()) {
      setStatus("error");
      setInvalidField("refNo");
      setMessage("Reference No is required.");
      return;
    }
    if (refNo.trim().length > 64) {
      setStatus("error");
      setInvalidField("refNo");
      setMessage("Reference No must be 64 characters or fewer.");
      return;
    }
    if (!title.trim()) {
      setStatus("error");
      setInvalidField("title");
      setMessage("Title is required.");
      return;
    }
    if (!UUID_RE.test(departmentId.trim())) {
      setStatus("error");
      setInvalidField("departmentId");
      setMessage("Department ID must be a valid UUID.");
      return;
    }
    if (vacancies < 1) {
      setStatus("error");
      setInvalidField("vacancies");
      setMessage("Vacancies must be at least 1.");
      return;
    }

    setStatus("submitting");
    setInvalidField(null);
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/hrms/job-openings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refNo: refNo.trim(),
          title: title.trim(),
          departmentId: departmentId.trim(),
          vacancies,
          vacancyType,
          description: description.trim() || undefined,
          closesAt: closesAt || undefined,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }

      // The API returns 202 Accepted (CQRS command queued), not a completed
      // creation — say so honestly rather than claiming it's done. Stay on
      // this page so the confirmation is actually seen (a redirect would
      // race it off-screen).
      setStatus("success");
      setMessage("Job opening submitted. It will appear in the vacancy list shortly.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}
      aria-describedby={message ? statusMsgId : undefined}
      noValidate
    >
      {templateName && (
        <div style={{ padding: "10px 14px", background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: 8, fontSize: 13, color: "#1e40af" }}>
          Pre-filled from template: <strong>{templateName}</strong>. You can edit any field before saving.
        </div>
      )}

      <div>
        <label htmlFor={refNoId} style={labelStyle}>
          Reference No <span aria-hidden="true">*</span>
        </label>
        <input
          id={refNoId}
          type="text"
          value={refNo}
          onChange={(e) => setRefNo(e.target.value)}
          placeholder="e.g. JOB-2024-0042"
          style={invalidField === "refNo" ? inputInvalidStyle : inputStyle}
          required
          aria-required="true"
          aria-invalid={invalidField === "refNo"}
          maxLength={64}
        />
      </div>

      <div>
        <label htmlFor={titleId} style={labelStyle}>
          Title <span aria-hidden="true">*</span>
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Senior Software Engineer"
          style={invalidField === "title" ? inputInvalidStyle : inputStyle}
          required
          aria-required="true"
          aria-invalid={invalidField === "title"}
        />
      </div>

      <div>
        <label htmlFor={deptId} style={labelStyle}>
          Department ID (UUID) <span aria-hidden="true">*</span>
        </label>
        <input
          id={deptId}
          type="text"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          placeholder="e.g. 3f2504e0-4f89-41d3-9a0c-0305e82c3301"
          style={invalidField === "departmentId" ? inputInvalidStyle : inputStyle}
          required
          aria-required="true"
          aria-invalid={invalidField === "departmentId"}
        />
      </div>

      <div>
        <label htmlFor={vacanciesId} style={labelStyle}>
          Vacancies
        </label>
        <input
          id={vacanciesId}
          type="number"
          min={1}
          value={vacancies}
          onChange={(e) => setVacancies(Number(e.target.value))}
          style={invalidField === "vacancies" ? inputInvalidStyle : inputStyle}
          required
          aria-invalid={invalidField === "vacancies"}
        />
      </div>

      <div>
        <label htmlFor={descId} style={labelStyle}>
          Description
        </label>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Job responsibilities, requirements, and qualifications"
          style={{ ...inputStyle, resize: "none", minHeight: 96 }}
        />
      </div>

      <div>
        <label htmlFor={closesAtId} style={labelStyle}>
          Closing Date
        </label>
        <input
          id={closesAtId}
          type="date"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="submit"
          disabled={status === "submitting" || status === "success"}
          className="btn primary"
          style={{ minHeight: 44, alignSelf: "flex-start" }}
        >
          {status === "submitting" ? "Creating…" : status === "success" ? "Submitted" : "Create Job Opening"}
        </button>
        {status === "success" && (
          <Link href="/hr/recruitment" className="btn ghost" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
            Back to Recruitment
          </Link>
        )}
      </div>

      {message && (
        <p
          id={statusMsgId}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          style={{
            fontSize: 14,
            color: status === "error" ? "var(--bad)" : "var(--good)",
            margin: 0,
          }}
        >
          <strong>{status === "error" ? "Error: " : "Success: "}</strong>
          {message}
        </p>
      )}
    </form>
  );
}
