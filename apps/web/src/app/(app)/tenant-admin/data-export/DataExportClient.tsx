"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, StatusPill, ConfirmDialog } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDate } from "@/lib/formatters";
import type { DataExportRequest } from "@/app/_data/loaders";

type ExportType = "full" | "module" | "entity";
type ExportFormat = "csv" | "json" | "pdf";

const MODULES = ["finance", "hrms", "payroll", "procurement", "projects", "assets", "inventory", "documents"];
// Full / payroll / hrms exports touch personal data and require a recorded purpose.
const MIN_PURPOSE_LEN = 10;

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function DataExportClient({ exports: initialExports, source }: { exports: DataExportRequest[]; source: "api" | "error" }) {
  const router = useRouter();
  const { data: seededExports, provenance, offline, cachedAt } = useSeededResource("admin.data-exports", initialExports, source, (d) => d.length === 0);
  const [exportType, setExportType] = useState<ExportType>("full");
  const [moduleFilter, setModuleFilter] = useState("");
  const [entityId, setEntityId] = useState("");
  const [format, setFormat] = useState<ExportFormat>("json");
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exports, setExports] = useState<DataExportRequest[]>(seededExports);
  const formError = useFormError("data export");

  // GAP-TENANT-ADMIN-DATA-EXPORT-02: a full / module (payroll|hrms) export of
  // personal data must be confirmed with a reason before it fires.
  const needsReason = exportType === "full" || (exportType === "module" && (moduleFilter === "payroll" || moduleFilter === "hrms"));

  function onExportClick() {
    formError.clear();
    if (needsReason) {
      setConfirmOpen(true);
    } else {
      void submit();
    }
  }

  async function submit(purpose?: string) {
    setSubmitting(true);
    formError.clear();
    try {
      // GAP-TENANT-ADMIN-DATA-EXPORT-01/03: check res.ok; never add an
      // optimistic "Processing" row on failure. Backend route is singular.
      const res = await fetch("/api/proxy/v1/admin/data-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          type: exportType,
          moduleFilter: exportType === "module" ? moduleFilter : null,
          entityId: exportType === "entity" ? entityId : undefined,
          format,
          ...(purpose ? { purpose } : {}),
        }),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        return;
      }
      setConfirmOpen(false);
      // The 202 body carries a server id; reflect server truth via refresh
      // rather than inventing a Date.now() id and a fake "processing" row.
      router.refresh();
      try {
        const body = (await res.json()) as { id?: string };
        if (body && body.id) {
          setExports((prev) => [{
            id: body.id as string,
            type: exportType,
            moduleFilter: exportType === "module" ? moduleFilter : null,
            format,
            status: "pending",
            fileSizeBytes: null,
            createdAt: new Date().toISOString(),
            expiresAt: null,
            downloadUrl: null,
          }, ...prev]);
        }
      } catch {
        // No/!json body — the router.refresh() above will reconcile.
      }
    } catch (caught) {
      formError.fromException("save", caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-h"><h3>Export organisation data</h3></div>
        <form
          onSubmit={(e) => { e.preventDefault(); onExportClick(); }}
          style={{ padding: 16 }}
        >
          {/* GAP-TENANT-ADMIN-DATA-EXPORT-05: responsive auto-fit grid instead of a fixed 4-col grid. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, alignItems: "end" }}>
            <div>
              <label htmlFor="export-type" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Export Type</label>
              <select id="export-type" className="ta-input" value={exportType} onChange={(e) => setExportType(e.target.value as ExportType)}>
                <option value="full">Full Export</option>
                <option value="module">By Module</option>
                <option value="entity">Single Entity</option>
              </select>
            </div>

            {exportType === "module" && (
              <div>
                <label htmlFor="module-filter" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Module</label>
                <select id="module-filter" className="ta-input" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
                  <option value="">Select module...</option>
                  {MODULES.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                </select>
              </div>
            )}

            {/* GAP-TENANT-ADMIN-DATA-EXPORT-03: entity export now names the entity. */}
            {exportType === "entity" && (
              <div>
                <label htmlFor="entity-id" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Entity ID</label>
                <input id="entity-id" className="ta-input" value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="e.g. employee or invoice id" required />
              </div>
            )}

            <div>
              <label htmlFor="export-format" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>Format</label>
              <select id="export-format" className="ta-input" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="pdf">PDF</option>
              </select>
            </div>

            <Button type="submit" disabled={submitting || (exportType === "module" && !moduleFilter) || (exportType === "entity" && !entityId)}>
              {submitting ? "Processing..." : "Export"}
            </Button>
          </div>
          <div role="alert" aria-live="assertive" style={{ marginTop: 10, fontSize: 13, color: "var(--bad)" }}>
            {!confirmOpen ? formError.message : ""}
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Export personal data?"
        danger
        requireReason
        minReasonLength={MIN_PURPOSE_LEN}
        reasonLabel="Purpose for this export (recorded in the audit log)"
        confirmLabel="Request export"
        busy={submitting}
        errorMessage={formError.message || undefined}
        description={
          <>
            This exports {exportType === "full" ? <b>all modules</b> : <b>{moduleFilter}</b>} and may include
            personal data (e.g. payroll / HRMS). The request is recorded with your identity and the purpose below.
          </>
        }
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => { if (!submitting) { setConfirmOpen(false); formError.clear(); } }}
      />

      <div className="card">
        <div className="card-h"><h3>Past Exports</h3></div>
        {exports.length === 0 ? (
          <EmptyState icon="📦" title="No exports yet" message="Request a data export above and it will appear here." />
        ) : (
          <div style={{ overflowX: "auto" }}>
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
                  <td>{formatIndianDate(exp.createdAt)}</td>
                  <td>{exp.type === "module" ? `Module: ${exp.moduleFilter}` : exp.type.charAt(0).toUpperCase() + exp.type.slice(1)}</td>
                  <td>{exp.format.toUpperCase()}</td>
                  <td>{formatSize(exp.fileSizeBytes)}</td>
                  {/* GAP-TENANT-ADMIN-DATA-EXPORT-05: shared StatusPill, not inline hex. */}
                  <td><StatusPill status={exp.status} /></td>
                  <td>
                    {/* GAP-TENANT-ADMIN-DATA-EXPORT-03: a ready export is a real
                        authenticated download link; aria-label uses a readable date. */}
                    {exp.status === "ready" ? (
                      <a
                        className="btn btn-sm"
                        href={exp.downloadUrl ?? `/api/proxy/v1/admin/data-export/${exp.id}/download`}
                        aria-label={`Download ${exp.type} export (${exp.format.toUpperCase()}) from ${formatIndianDate(exp.createdAt)}`}
                      >
                        ⬇️ Download
                      </a>
                    ) : exp.status === "processing" ? (
                      <span style={{ color: "var(--ink2)", fontSize: 12 }}>Processing</span>
                    ) : exp.status === "expired" ? (
                      <span style={{ color: "var(--ink2)", fontSize: 12 }}>Expired</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  );
}
