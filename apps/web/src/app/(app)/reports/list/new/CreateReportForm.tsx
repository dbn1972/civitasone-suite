"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormError } from "@/lib/useFormError";
import { Select } from "@/app/_components/ds";

/**
 * Queues a report generation job via POST /api/proxy/v1/reports/jobs
 * (createJobBody: { name, reportType? }).
 *
 * GAP-REPORTS-LIST-NEW-03: the report type / module was a free-text input, so a
 * typo ("Finanace") created an unusable job. It is now a <select> of known
 * modules. NOTE: report-service's createJobBody accepts ONLY { name,
 * reportType? } — it does not accept a format or a date range — so no format
 * or from/to fields are added here (adding inputs the backend silently ignores
 * would be worse than omitting them). HUMAN REVIEW: adding format/date-range
 * needs a report-service contract change (createJobBody + @civitasone/types).
 */
const REPORT_TYPES: { value: string; label: string }[] = [
  { value: "", label: "General (unspecified)" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "procurement", label: "Procurement" },
  { value: "assets", label: "Assets" },
  { value: "citizen", label: "Citizen services" },
  { value: "crm", label: "CRM" },
  { value: "helpdesk", label: "Helpdesk" },
  { value: "kpi-target", label: "KPI target" },
];

const KNOWN_VALUES = new Set(REPORT_TYPES.map((t) => t.value));

export function CreateReportForm({ defaultReportType = "" }: { defaultReportType?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  // If an unknown reportType arrives via the query string, fall back to the
  // "General" option rather than silently keeping an invalid value.
  const [reportType, setReportType] = useState(KNOWN_VALUES.has(defaultReportType) ? defaultReportType : "");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("report");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 1) {
      setStatus("error");
      setMessage("Report name is required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    const body = {
      name: name.trim(),
      reportType: reportType.trim() || undefined,
    };
    try {
      const res = await fetch("/api/proxy/v1/reports/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      router.push("/reports/list");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        {/* GAP-REPORTS-LIST-NEW-04: drop the inline background:#fff (broke dark
            mode); let the card/field tokens handle the surface. */}
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="name">Report name *</label>
          <input id="name" className="inp" value={name} onChange={(e) => setName(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. Monthly expenditure summary" />
        </div>
        <div className="field">
          <label className="label" htmlFor="reportType">Report type / module</label>
          <Select id="reportType" value={reportType} onChange={(e) => setReportType(e.target.value)} style={{ minHeight: 44 }}>
            {REPORT_TYPES.map((t) => (
              <option key={t.value || "general"} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          // GAP-REPORTS-LIST-NEW-04: token colours, not hard-coded hex, so the
          // error/success message is readable in dark mode.
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Queuing…" : "Queue report"}
        </button>
        <Link href="/reports/list" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
