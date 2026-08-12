"use client";

import { useState } from "react";
import { EmptyState } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { DataExportRequest } from "@/app/_data/loaders";

type ExportType = "full" | "module" | "entity";
type ExportFormat = "csv" | "json" | "pdf";
type ExportStatus = "pending" | "processing" | "ready" | "expired" | "failed";

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

export function DataExportClient({ exports: initialExports, source }: { exports: DataExportRequest[]; source: "api" | "error" }) {
  const { data: seededExports } = useSeededResource("admin.data-exports", initialExports, source, (d) => d.length === 0);
  const [exportType, setExportType] = useState<ExportType>("full");
  const [moduleFilter, setModuleFilter] = useState("");
  const [format, setFormat] = useState<ExportFormat>("json");
  const [submitting, setSubmitting] = useState(false);
  const [exports, setExports] = useState<DataExportRequest[]>(seededExports);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // POST to /api/v1/admin/data-exports → 202
    void fetch("/api/proxy/v1/admin/data-exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ type: exportType, moduleFilter: exportType === "module" ? moduleFilter : null, format }),
    }).then(() => {
      setExports((prev) => [{
        id: String(Date.now()),
        type: exportType,
        moduleFilter: exportType === "module" ? moduleFilter : null,
        format,
        status: "processing" as const,
        fileSizeBytes: null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
      }, ...prev]);
    }).finally(() => setSubmitting(false));
  }

  return (
    <>
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
        {exports.length === 0 ? (
          <EmptyState icon="📦" title="No exports yet" message="Request a data export above and it will appear here." />
        ) : (
          <table className="data-table" role="table" aria-label="Past data exports">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Format</th>
                <th scope="col">Size</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
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
                      <button className="btn btn-sm" aria-label={`Download export from ${exp.createdAt}`}>⬇️ Download</button>
                    )}
                    {exp.status === "processing" && <span style={{ color: "#3b82f6", fontSize: 12 }}>⏳ ~2 min</span>}
                    {exp.status === "expired" && <span style={{ color: "#6b7280", fontSize: 12 }}>Expired</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
