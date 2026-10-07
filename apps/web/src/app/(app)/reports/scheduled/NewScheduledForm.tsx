"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import type { ReportTemplateOption } from "@/app/_data/loaders";

type FormState = { status: "idle" | "submitting" | "success" | "error"; message?: string };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: "0.875rem",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "4px",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--ink2)",
};

export function NewScheduledForm({ templates }: { templates: ReportTemplateOption[] }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [templateId, setTemplateId] = useState("");
  const [cadence, setCadence] = useState("daily");
  const [recipients, setRecipients] = useState("");
  const [format, setFormat] = useState("pdf");
  const formError = useFormError("scheduled report");

  const noTemplates = templates.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "submitting" });
    try {
      const body = {
        templateId,
        cadence,
        recipients: recipients.split(",").map((r) => r.trim()).filter(Boolean),
        format,
      };
      // GAP-REPORTS-SCHEDULED-02: create via the same /api/proxy/v1 gateway
      // prefix the list read uses (through fetchJson -> /api/v1), so both the
      // read and the write hit one resource rather than two divergent prefixes.
      const res = await browserFetch("v1/reports/scheduled", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setState({ status: "error", message: await errorMessageFromResponse(res, "save") });
        return;
      }
      setState({ status: "success", message: "Scheduled report created." });
      setTemplateId("");
      setRecipients("");
      // GAP-REPORTS-SCHEDULED-03: refresh the server component so the new row
      // (and the Total/Enabled stat counts) appear without a manual reload.
      router.refresh();
    } catch (caught) {
      setState({ status: "error", message: formError.fromException("save", caught).message });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px", maxWidth: "480px" }}
    >
      <div>
        <label htmlFor="scheduled-report-template-id" style={labelStyle}>Report template</label>
        {/* GAP-REPORTS-SCHEDULED-01: a named dropdown of real templates,
            submitting the id — not a free-typed UUID nobody can recognise. */}
        <select
          id="scheduled-report-template-id"
          required
          style={inputStyle}
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          disabled={noTemplates}
        >
          <option value="" disabled>
            {noTemplates ? "No report templates available" : "Select a report template"}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {noTemplates ? (
          <p style={{ color: "var(--ink2)", fontSize: "0.8125rem", margin: "6px 0 0" }}>
            Create a report template first, then schedule it here.
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="scheduled-report-cadence" style={labelStyle}>Cadence</label>
        <select id="scheduled-report-cadence" style={inputStyle} value={cadence} onChange={(e) => setCadence(e.target.value)}>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div>
        <label htmlFor="scheduled-report-recipients" style={labelStyle}>
          Recipients <span style={{ fontWeight: 400 }}>(comma-separated emails)</span>
        </label>
        <input
          id="scheduled-report-recipients"
          required
          type="text"
          style={inputStyle}
          placeholder="alice@example.com, bob@example.com"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="scheduled-report-format" style={labelStyle}>Format</label>
        <select id="scheduled-report-format" style={inputStyle} value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="pdf">PDF</option>
          <option value="xlsx">XLSX</option>
          <option value="csv">CSV</option>
        </select>
      </div>
      {state.status === "error" && (
        <p role="alert" style={{ color: "var(--bad)", fontSize: "0.875rem", margin: 0 }}>{state.message}</p>
      )}
      {state.status === "success" && (
        <p role="status" style={{ color: "var(--good)", fontSize: "0.875rem", margin: 0 }}>{state.message}</p>
      )}
      <button
        type="submit"
        disabled={state.status === "submitting" || noTemplates}
        className="btn primary"
        style={{ alignSelf: "flex-start" }}
      >
        {state.status === "submitting" ? "Creating…" : "Create Schedule"}
      </button>
    </form>
  );
}
