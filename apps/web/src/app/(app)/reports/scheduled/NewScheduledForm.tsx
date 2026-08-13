"use client";

import { useState } from "react";

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

export function NewScheduledForm() {
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [templateId, setTemplateId] = useState("");
  const [cadence, setCadence] = useState("daily");
  const [recipients, setRecipients] = useState("");
  const [format, setFormat] = useState("pdf");

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
      const res = await fetch("/api/v1/reports/scheduled", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setState({ status: "error", message: (err as { message?: string }).message ?? "Request failed" });
        return;
      }
      setState({ status: "success", message: "Scheduled report created." });
      setTemplateId("");
      setRecipients("");
    } catch {
      setState({ status: "error", message: "Network error — please try again." });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px", maxWidth: "480px" }}
    >
      <div>
        <label style={labelStyle}>Template ID</label>
        <input
          required
          style={inputStyle}
          placeholder="UUID of report template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          pattern="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
        />
      </div>
      <div>
        <label style={labelStyle}>Cadence</label>
        <select style={inputStyle} value={cadence} onChange={(e) => setCadence(e.target.value)}>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>
          Recipients <span style={{ fontWeight: 400 }}>(comma-separated emails)</span>
        </label>
        <input
          required
          type="text"
          style={inputStyle}
          placeholder="alice@example.com, bob@example.com"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
        />
      </div>
      <div>
        <label style={labelStyle}>Format</label>
        <select style={inputStyle} value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="pdf">PDF</option>
          <option value="xlsx">XLSX</option>
          <option value="csv">CSV</option>
        </select>
      </div>
      {state.status === "error" && (
        <p style={{ color: "var(--bad)", fontSize: "0.875rem", margin: 0 }}>{state.message}</p>
      )}
      {state.status === "success" && (
        <p style={{ color: "var(--good)", fontSize: "0.875rem", margin: 0 }}>{state.message}</p>
      )}
      <button
        type="submit"
        disabled={state.status === "submitting"}
        className="btn primary"
        style={{ alignSelf: "flex-start" }}
      >
        {state.status === "submitting" ? "Creating…" : "Create Schedule"}
      </button>
    </form>
  );
}
