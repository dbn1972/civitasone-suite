"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { InvestigationSummary } from "@/app/_data/loaders";

const STATUS_LABELS: Record<InvestigationSummary["status"], string> = {
  in_progress: "In Progress",
  findings_submitted: "Findings Submitted",
  closed: "Closed",
  unknown: "Unknown",
};

// GAP-AUDIT-INVESTIGATION-03: show a formatted date but keep the raw ISO value
// for chronological sorting. A malformed value renders as its raw string, not
// "Invalid Date".
function renderStarted(value: string): string {
  if (!value) return "—";
  const formatted = formatIndianDate(value);
  return formatted === "Invalid Date" || formatted === "—" ? value : formatted;
}

export function InvestigationTable({ rows, source, canViewDetail = false }: { rows: InvestigationSummary[]; source: "api" | "error"; canViewDetail?: boolean }) {
  const { data, provenance, cachedAt, offline } = useSeededResource("audit.investigations", rows, source, (d) => d.length === 0);

  // GAP-AUDIT-INVESTIGATION-02: mask sensitive free text for roles that may not
  // read case content. "••••••" is shown instead of subject/findings, and CSV
  // export is disabled. Server-side redaction is a HUMAN REVIEW follow-up.
  const mask = (value: string): string => (canViewDetail ? value : "••••••");

  return (
    <>
      {provenance ? <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} /> : null}
      <DataTable<InvestigationSummary & Record<string, unknown>>
      columns={[
        { key: "caseId", label: "Case ID", sortable: true },
        { key: "subject", label: "Subject", render: (row) => mask(String(row.subject ?? "")) },
        { key: "assignedTo", label: "Assigned To" },
        { key: "started", label: "Started", sortable: true, render: (row) => renderStarted(row.started as string) },
        { key: "findings", label: "Findings", render: (row) => mask(String(row.findings ?? "")) },
        { key: "status", label: "Status", render: (row) => <StatusPill status={STATUS_LABELS[row.status as InvestigationSummary["status"]] ?? String(row.status)} /> },
      ]}
      rows={data as (InvestigationSummary & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search investigations..."
      pageSize={15}
      exportable={canViewDetail}
      exportFilename="investigations"
    />
    </>
  );
}
