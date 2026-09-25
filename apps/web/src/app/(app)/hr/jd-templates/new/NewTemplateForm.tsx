"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../../../_components/ds";

const VACANCY_TYPES = [
  { value: "regular", label: "Regular Position" },
  { value: "internship", label: "Internship" },
  { value: "apprenticeship", label: "Apprenticeship" },
  { value: "volunteership", label: "Volunteer Role" },
  { value: "contractual", label: "Contractual" },
  { value: "deputation", label: "Deputation" },
];

type TemplateResponse = {
  name?: string;
  vacancyType?: string;
  description?: string;
  qualification?: string;
  payRange?: string;
  selectionProcess?: string;
  tags?: string[];
};

/**
 * HIGH fix: the JD Template Library's "Edit" link (jd-templates/page.tsx ->
 * /hr/jd-templates/{id}) was a dead 404 -- no [id]/page.tsx existed. Rather
 * than building a separate edit UI from scratch, this same create form now
 * takes an optional `templateId`: absent, it behaves exactly as before
 * (POST, create); present, it loads the existing template and PATCHes it
 * (updateJdTemplateBody in jd-template-routes.ts already accepts every field
 * this form collects, via createJdTemplateBody.partial()). See
 * jd-templates/[id]/page.tsx for the new edit route that renders this in
 * edit mode.
 */
export function NewTemplateForm({ templateId }: { templateId?: string }) {
  const router = useRouter();
  const isEdit = !!templateId;
  const [name, setName] = useState("");
  const [vacancyType, setVacancyType] = useState("regular");
  const [description, setDescription] = useState("");
  const [qualification, setQualification] = useState("");
  const [payRange, setPayRange] = useState("");
  const [selectionProcess, setSelectionProcess] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/jd-templates/${templateId}`);
        if (!res.ok) { if (!cancelled) setLoadError(true); return; }
        const tmpl = await res.json() as TemplateResponse;
        if (cancelled) return;
        setName(tmpl.name ?? "");
        setVacancyType(tmpl.vacancyType ?? "regular");
        setDescription(tmpl.description ?? "");
        setQualification(tmpl.qualification ?? "");
        setPayRange(tmpl.payRange ?? "");
        setSelectionProcess(tmpl.selectionProcess ?? "");
        setTags((tmpl.tags ?? []).join(", "));
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setStatus("error"); setMessage("Template name is required."); return; }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch(
        isEdit ? `/api/proxy/v1/hrms/jd-templates/${templateId}` : "/api/proxy/v1/hrms/jd-templates",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            vacancyType,
            description: description.trim() || undefined,
            qualification: qualification.trim() || undefined,
            payRange: payRange.trim() || undefined,
            selectionProcess: selectionProcess.trim() || undefined,
            tags: tags.trim() ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
          }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Something went wrong." })) as { message?: string };
        setStatus("error");
        setMessage(err.message ?? (isEdit ? "Failed to update template." : "Failed to create template."));
        return;
      }

      setStatus("success");
      setMessage(isEdit ? "Template updated successfully." : "Template created successfully.");
      setTimeout(() => router.push("/hr/jd-templates"), 1000);
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid var(--line, #cbd5e1)",
    borderRadius: 8, boxSizing: "border-box", color: "var(--ink, #0f172a)", background: "var(--panel, #fff)",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink2, #334155)", marginBottom: 5,
  };

  if (loading) {
    return <p style={{ textAlign: "center", color: "var(--mut)", padding: "48px 0" }}>Loading template…</p>;
  }

  if (loadError) {
    return (
      <div style={{ maxWidth: 640 }}>
        <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "var(--badbg, #fef2f2)", color: "var(--bad, #b91c1c)", fontSize: 13, border: "1px solid var(--badbd, #fecaca)" }}>
          This template could not be loaded. It may have been removed.
        </p>
        <a href="/hr/jd-templates" style={{ display: "inline-block", marginTop: 14, padding: "10px 20px", fontSize: 14, fontWeight: 600, color: "var(--ink2, #475569)", background: "var(--bg, #f1f5f9)", borderRadius: 8, textDecoration: "none" }}>
          Back to JD Templates
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 640, display: "grid", gap: 18 }}>
      <div>
        <label htmlFor="tpl-name" style={labelStyle}>Template name *</label>
        <input id="tpl-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Junior Data Analyst — Internship" style={inputStyle} required />
      </div>

      <div>
        <label htmlFor="tpl-type" style={labelStyle}>Vacancy type *</label>
        <select id="tpl-type" value={vacancyType} onChange={(e) => setVacancyType(e.target.value)} style={inputStyle}>
          {VACANCY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="tpl-desc" style={labelStyle}>Job description</label>
        <textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)}
          rows={5} placeholder="Role overview, responsibilities, and expected outcomes..."
          style={{ ...inputStyle, resize: "vertical" }} />
      </div>

      <div>
        <label htmlFor="tpl-qual" style={labelStyle}>Qualification requirements</label>
        <input id="tpl-qual" type="text" value={qualification} onChange={(e) => setQualification(e.target.value)}
          placeholder="e.g. B.Tech / B.E. in Computer Science or equivalent" style={inputStyle} />
      </div>

      <div>
        <label htmlFor="tpl-pay" style={labelStyle}>Pay / Stipend range</label>
        <input id="tpl-pay" type="text" value={payRange} onChange={(e) => setPayRange(e.target.value)}
          placeholder="e.g. ₹8,000–₹12,000/month or Pay Level 6 (₹35,400–₹1,12,400)" style={inputStyle} />
      </div>

      <div>
        <label htmlFor="tpl-sel" style={labelStyle}>Selection process</label>
        <textarea id="tpl-sel" value={selectionProcess} onChange={(e) => setSelectionProcess(e.target.value)}
          rows={3} placeholder="e.g. Written Test → Group Discussion → Interview"
          style={{ ...inputStyle, resize: "vertical" }} />
      </div>

      <div>
        <label htmlFor="tpl-tags" style={labelStyle}>Tags (comma-separated)</label>
        <input id="tpl-tags" type="text" value={tags} onChange={(e) => setTags(e.target.value)}
          placeholder="e.g. data, analytics, graduate, entry-level" style={inputStyle} />
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>Tags help HR search and find templates quickly.</p>
      </div>

      {status === "error" && (
        <p role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "var(--badbg, #fef2f2)", color: "var(--bad, #b91c1c)", fontSize: 13, border: "1px solid var(--badbd, #fecaca)" }}>
          {message}
        </p>
      )}
      {status === "success" && (
        <p style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "var(--goodbg, #f0fdf4)", color: "var(--good, #15803d)", fontSize: 13, border: "1px solid var(--goodbd, #bbf7d0)" }}>
          {message}
        </p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <Button type="submit" variant="primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : isEdit ? "Save changes" : "Save template"}
        </Button>
        <a href="/hr/jd-templates" style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600, color: "var(--ink2, #475569)", background: "var(--bg, #f1f5f9)", borderRadius: 8, textDecoration: "none" }}>
          Cancel
        </a>
      </div>
    </form>
  );
}
