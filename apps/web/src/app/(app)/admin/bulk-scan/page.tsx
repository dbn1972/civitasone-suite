"use client";

import { useState } from "react";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 } as const;
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 4 } as const;

type ScanJob = {
  id: string;
  name: string;
  domainCount: number;
  scanType: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
};

const MOCK_JOBS: ScanJob[] = [
  { id: "j1", name: "Ministry portals — Jul 2026", domainCount: 24, scanType: "wcag", status: "completed", createdAt: "2026-07-15" },
  { id: "j2", name: "State government sites", domainCount: 58, scanType: "full", status: "completed", createdAt: "2026-07-01" },
  { id: "j3", name: "August sweep — NIC portals", domainCount: 12, scanType: "cwv", status: "running", createdAt: "2026-08-14" },
];

const STATUS_COLORS: Record<ScanJob["status"], string> = {
  queued: "#6b7280",
  running: "#2563eb",
  completed: "#059669",
  failed: "#dc2626",
};

export default function AdminBulkScanPage() {
  const [jobName, setJobName] = useState("");
  const [domainList, setDomainList] = useState("");
  const [scanType, setScanType] = useState("full");
  const [schedule, setSchedule] = useState("now");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domainList.trim()) {
      setError("Please enter at least one domain.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const domains = domainList
        .split(/[\n,]+/)
        .map((d) => d.trim())
        .filter(Boolean);
      const res = await fetch("/api/v1/admin/bulk-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: jobName, domains, scanType, schedule, notes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Request failed: ${res.status}`);
      }
      setSuccess(`Bulk scan job "${jobName}" queued for ${domains.length} domain(s).`);
      setJobName("");
      setDomainList("");
      setScanType("full");
      setSchedule("now");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue bulk scan.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bulk Scan"
        subtitle="Queue a WCAG/CWV/accessibility scan across multiple government domains at once."
        back="/admin"
      />

      {/* New job form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-h"><h3>New Scan Job</h3></div>
        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          {error && (
            <div
              role="alert"
              aria-live="polite"
              style={{ background: "#fef2f2", color: "#b42318", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}
            >
              {error}
            </div>
          )}
          {success && (
            <div
              role="status"
              aria-live="polite"
              style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}
            >
              {success}
            </div>
          )}

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: 16 }}>
            <div>
              <label htmlFor="bulk-job-name" style={labelStyle}>
                Job Name *
              </label>
              <input
                id="bulk-job-name"
                type="text"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="e.g. August sweep — Ministry sites"
                style={inputStyle}
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="bulk-scan-type" style={labelStyle}>
                Scan Type *
              </label>
              <select
                id="bulk-scan-type"
                value={scanType}
                onChange={(e) => setScanType(e.target.value)}
                style={inputStyle}
                required
                aria-required="true"
              >
                <option value="full">Full (WCAG + CWV + UX4G)</option>
                <option value="wcag">WCAG 2.2 AA only</option>
                <option value="cwv">Core Web Vitals only</option>
                <option value="gigw">GIGW 3.0 only</option>
              </select>
            </div>

            <div>
              <label htmlFor="bulk-schedule" style={labelStyle}>
                Schedule *
              </label>
              <select
                id="bulk-schedule"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                style={inputStyle}
                required
                aria-required="true"
              >
                <option value="now">Run immediately</option>
                <option value="off-peak">Tonight (off-peak)</option>
                <option value="weekend">This weekend</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label htmlFor="bulk-domain-list" style={labelStyle}>
              Domain List * (one per line or comma-separated)
            </label>
            <textarea
              id="bulk-domain-list"
              value={domainList}
              onChange={(e) => setDomainList(e.target.value)}
              placeholder={"india.gov.in\nic.in\nmygov.in"}
              rows={6}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 13 }}
              required
              aria-required="true"
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label htmlFor="bulk-notes" style={labelStyle}>
              Notes
            </label>
            <textarea
              id="bulk-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes for this scan job…"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "10px 28px",
              borderRadius: 8,
              background: submitting ? "#9ca3af" : "#4f46e5",
              color: "#fff",
              fontWeight: 600,
              border: "none",
              cursor: submitting ? "not-allowed" : "pointer",
              fontSize: 14,
            }}
          >
            {submitting ? "Queuing…" : "Queue Bulk Scan"}
          </button>
        </form>
      </div>

      {/* Job history */}
      <div className="card">
        <div className="card-h"><h3>Recent Jobs</h3></div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" role="table" aria-label="Bulk scan job history">
            <thead>
              <tr>
                <th scope="col">Job Name</th>
                <th scope="col">Domains</th>
                <th scope="col">Scan Type</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_JOBS.map((job) => (
                <tr key={job.id}>
                  <td><strong>{job.name}</strong></td>
                  <td>{job.domainCount}</td>
                  <td>{job.scanType.toUpperCase()}</td>
                  <td>
                    <span style={{ color: STATUS_COLORS[job.status], fontWeight: 600, textTransform: "capitalize" }}>
                      {job.status}
                    </span>
                  </td>
                  <td style={{ color: "#6b7280", fontSize: 13 }}>{job.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
