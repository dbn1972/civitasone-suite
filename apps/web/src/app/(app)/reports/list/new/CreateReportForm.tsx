"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Queues a report generation job via POST /api/v1/reports/jobs
 * (createJobBody: name, reportType?).
 */
export function CreateReportForm({ defaultReportType = "" }: { defaultReportType?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [reportType, setReportType] = useState(defaultReportType);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

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
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      router.push("/reports/list");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="name">Report name *</label>
          <input id="name" className="inp" value={name} onChange={(e) => setName(e.target.value)} required style={{ minHeight: 44 }} placeholder="e.g. Monthly expenditure summary" />
        </div>
        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="reportType">Report type / module</label>
          <input id="reportType" className="inp" value={reportType} onChange={(e) => setReportType(e.target.value)} style={{ minHeight: 44 }} placeholder="e.g. finance, hr, kpi-target" />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "#b91c1c" : "#047857", fontSize: "0.875rem" }}>
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
