"use client";

import Link from "next/link";
import { useState } from "react";
import { DataTable, Segmented, StatusPill } from "../../../_components/ds";

export type JobRow = {
  id: string;
  reportName: string;
  module: string;
  requestedBy: string;
  format: string;
  statusPill: string;
  download: string;
  downloadUrl: string | null;
} & Record<string, unknown>;

// GAP-REPORTS-LIST-02: a dedicated status filter above the table (the only
// filter before was the DataTable free-text box). Row-level retry/cancel
// actions are intentionally NOT added: report-service exposes no retry or
// cancel endpoint and its job status enum has no "cancelled" state, so wiring
// those controls would be fabricating behaviour. See report / HUMAN REVIEW.
const SEG_OPTIONS = ["All", "Running", "Completed", "Failed"] as const;
const SEG_TO_STATUS: Record<string, string | null> = {
  All: null,
  Running: "running",
  Completed: "completed",
  Failed: "failed",
};

export function ReportJobsTable({ rows }: { rows: JobRow[] }) {
  const [seg, setSeg] = useState<string>("All");
  const wanted = SEG_TO_STATUS[seg];
  const filtered = wanted ? rows.filter((r) => r.statusPill === wanted) : rows;

  return (
    <>
      <div className="card-h" style={{ paddingTop: 0 }}>
        <Segmented options={[...SEG_OPTIONS]} value={seg} onChange={setSeg} />
      </div>
      <DataTable<JobRow>
        columns={[
          {
            key: "reportName",
            label: "Report Name",
            render: (row) => (
              <Link href={`/reports/${row.id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>
                {row.reportName}
              </Link>
            ),
          },
          { key: "module", label: "Module" },
          { key: "requestedBy", label: "Requested By" },
          { key: "format", label: "Format" },
          {
            key: "statusPill",
            label: "Status",
            render: (row) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <StatusPill status={row.statusPill} />
                {/* GAP-REPORTS-LIST-02: a failed job showed only "—" with no
                    hint of why. report-service does not persist a per-job error
                    reason, so the honest line is that none was recorded rather
                    than a bare dash. */}
                {row.statusPill === "failed" && (
                  <span style={{ fontSize: "11px", color: "var(--mut)" }}>Reason not recorded</span>
                )}
              </div>
            ),
          },
          {
            key: "download",
            label: "Download",
            sortable: false,
            render: (row) =>
              row.downloadUrl ? (
                <a href={row.downloadUrl} target="_blank" rel="noopener noreferrer"
                  style={{ color: "var(--primary)", fontSize: "13px" }}>
                  Download
                </a>
              ) : (
                <span style={{ color: "var(--mut)" }}>—</span>
              ),
          },
        ]}
        rows={filtered}
        sortable
        filterable
        pageSize={15}
      />
    </>
  );
}
