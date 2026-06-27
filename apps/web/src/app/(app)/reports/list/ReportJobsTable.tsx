"use client";

import Link from "next/link";
import { DataTable, StatusPill } from "../../../_components/ds";

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

export function ReportJobsTable({ rows }: { rows: JobRow[] }) {
  return (
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
          render: (row) => <StatusPill status={row.statusPill} />,
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
              <span style={{ color: "#98a2b3" }}>—</span>
            ),
        },
      ]}
      rows={rows}
      sortable
      filterable
      pageSize={15}
    />
  );
}
