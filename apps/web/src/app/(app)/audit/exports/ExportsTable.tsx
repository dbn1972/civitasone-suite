"use client";

import { DataTable } from "../../../_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import type { AuditExportJob } from "@civitasone/types";
import { VerifyButton } from "./VerifyButton";

export type ExportRow = AuditExportJob & Record<string, unknown>;

// GAP-AUDIT-EXPORTS-04: build the download href the same tokenised way as the
// Current-job panel — through the proxy with the signed token — rather than
// linking the raw signedUrl, so the server's requester/PII re-check applies.
function downloadHref(row: ExportRow): string | null {
  if (row.status !== "completed" || !row.downloadUrl) return null;
  return `/api/proxy/v1/audit/exports/${row.id}/download?token=${encodeURIComponent(row.downloadUrl)}`;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function windowLabel(row: ExportRow): string {
  if (!row.periodFrom || !row.periodTo) return "—";
  const f = row.periodFrom.slice(0, 10);
  const t = row.periodTo.slice(0, 10);
  return `${f} → ${t}`;
}

export function ExportsTable({ rows }: { rows: ExportRow[] }) {
  return (
    <DataTable<ExportRow>
      columns={[
        { key: "id", label: "Job", sortable: false, render: (item) => <span className="mono" title={item.id}>{shortId(item.id)}</span> },
        { key: "jobType", label: "Export", render: (item) => <span className="mono">{item.jobType}</span> },
        { key: "periodFrom", label: "Window", sortable: false, render: (item) => <span style={{ fontSize: 12 }}>{windowLabel(item)}</span> },
        { key: "rowCount", label: "Rows", align: "right", render: (item) => (item.rowCount != null ? item.rowCount.toLocaleString("en-IN") : "—") },
        { key: "includesPii", label: "PII", render: (item) => (item.includesPii ? <span className="pill warn">Yes</span> : <span className="pill mut">No</span>) },
        { key: "requestedBy", label: "Requested by", render: (item) => <span className="mono" style={{ fontSize: 12 }}>{item.requestedBy}</span> },
        { key: "requestedAt", label: "Requested", render: (item) => formatIndianDateTime(item.requestedAt) },
        {
          key: "format",
          label: "Format",
          render: (item) => <span className="pill info">{item.format.toUpperCase()}</span>,
        },
        {
          key: "status",
          label: "Status",
          render: (item) => {
            const s = item.status;
            if (s === "completed") return <span className="pill good">Ready</span>;
            if (s === "processing") return <span className="pill warn">Generating</span>;
            if (s === "failed") return <span className="pill bad">Failed</span>;
            return <span className="pill mut">Queued</span>;
          },
        },
        {
          key: "downloadUrl",
          label: "Download",
          sortable: false,
          render: (item) => {
            const href = downloadHref(item);
            return href
              ? <a href={href} className="lnk" download>Download</a>
              : <span style={{ color: "var(--mut)" }}>—</span>;
          },
        },
        {
          key: "verify",
          label: "Integrity",
          sortable: false,
          render: (item) => (item.status === "completed" ? <VerifyButton jobId={item.id} /> : <span style={{ color: "var(--mut)" }}>—</span>),
        },
      ]}
      rows={rows}
    />
  );
}
