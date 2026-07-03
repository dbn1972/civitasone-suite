"use client";

import { useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";

type ExportType = "full" | "module" | "entity";
type ExportFormat = "csv" | "json" | "pdf";
type ExportStatus = "pending" | "processing" | "ready" | "expired" | "failed";

interface ExportRequest {
  id: string;
  type: ExportType;
  moduleFilter: string | null;
  format: ExportFormat;
  status: ExportStatus;
  fileSizeBytes: number | null;
  createdAt: string;
  expiresAt: string | null;
}

const PAST_EXPORTS: ExportRequest[] = [
  { id: "1", type: "full", moduleFilter: null, format: "json", status: "ready", fileSizeBytes: 2457600, createdAt: "2024-06-01T10:00:00Z", expiresAt: "2024-06-03T10:00:00Z" },
  { id: "2", type: "module", moduleFilter: "finance", format: "csv", status: "ready", fileSizeBytes: 512000, createdAt: "2024-05-28T14:30:00Z", expiresAt: "2024-05-30T14:30:00Z" },
  { id: "3", type: "full", moduleFilter: null, format: "pdf", status: "expired", fileSizeBytes: 4096000, createdAt: "2024-05-15T09:00:00Z", expiresAt: "2024-05-17T09:00:00Z" },
  { id: "4", type: "entity", moduleFilter: null, format: "json", status: "processing", fileSizeBytes: null, createdAt: "2024-06-10T08:00:00Z", expiresAt: null },
];

const MODULES = ["finance", "hrms", "payroll", "procurement", "projects", "assets", "inventory", "documents"];

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function statusBadge(status: ExportStatus) {
  const colors: Record<ExportStatus, string> = {
    pending: "#f59e0b",
    processing: "#3b82f6",
    ready: "#10b981",
    expired: "#6b7280",
    failed: "#ef4444",
  };
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 12, fontSize: 12, background: `${colors[status]}20`, color: colors[status], fontWeight: 600 }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function DataExportPage() {
  const [exportType, setExportType] = useState<ExportType>("full");
  const [moduleFilter, setModuleFilter] = useState("");
  const [format, setFormat] = useState<ExportFormat>("json");
  const [submitting, setSubmitting] = useState(false);
  const [exports, setExports] = useState<ExportRequest[]>(PAST_EXPORTS);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Simulate API call
    setTimeout(() => {
      setExports((prev) => [{
        id: String(Date.now()),
        type: exportType,
        moduleFilter: exportType === "module" ? moduleFilter : null,
        format,
        status: "processing",
        fileSizeBytes: null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
      }, ...prev]);
      setSubmitting(false);
    }, 1000);
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Data Export" subtitle="Export your organisation's data under DPDP Act 2023 compliance." back="/tenant-admin" />

      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <p style={{ margin: 0, fontSize: 14, color: "#1e40af" }}>
          📋 <strong>DPDP Notice:</strong> Under the Digital Personal Data Protection Act 2023, you have the right to export your data.
          Exports are available for download for 48 hours after generation.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-h"><h3>Export My Data</h3></div>
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 16, alignItems: "end" }}>
            <div>
              <label htmlFor="export-type" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Export Type</label>
              <select id="export-type" className="input" value={exportType} onChange={(e) => setExportType(e.target.value as ExportType)}>
                <option value="full">Full Export</option>
                <option value="module">By Module</option>
                <option value="entity">Single Entity</option>
              </select>
            </div>

            {exportType === "module" && (
              <div>
                <label htmlFor="module-filter" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Module</label>
                <select id="module-filter" className="input" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
                  <option value="">Select module...</option>
                  {MODULES.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="export-format" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Format</label>
              <select id="export-format" className="input" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="pdf">PDF</option>
              </select>
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting || (exportType === "module" && !moduleFilter)}>
              {submitting ? "Processing..." : "🚀 Export"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-h"><h3>Past Exports</h3></div>
        <table className="data-table" role="table" aria-label="Past data exports">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Format</th>
              <th>Size</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {exports.map((exp) => (
              <tr key={exp.id}>
                <td>{new Date(exp.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{exp.type === "module" ? `Module: ${exp.moduleFilter}` : exp.type.charAt(0).toUpperCase() + exp.type.slice(1)}</td>
                <td>{exp.format.toUpperCase()}</td>
                <td>{formatSize(exp.fileSizeBytes)}</td>
                <td>{statusBadge(exp.status)}</td>
                <td>
                  {exp.status === "ready" && (
                    <button className="btn btn-sm" aria-label={`Download export from ${exp.createdAt}`}>
                      ⬇️ Download
                    </button>
                  )}
                  {exp.status === "processing" && <span style={{ color: "#3b82f6", fontSize: 12 }}>⏳ ~2 min</span>}
                  {exp.status === "expired" && <span style={{ color: "#6b7280", fontSize: 12 }}>Expired</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
