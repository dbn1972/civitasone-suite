"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { InvestigationSummary } from "@/app/_data/loaders";

const STATUS_LABELS: Record<InvestigationSummary["status"], string> = {
  in_progress: "In Progress",
  findings_submitted: "Findings Submitted",
  closed: "Closed",
};

export function InvestigationTable({ rows, source }: { rows: InvestigationSummary[]; source: "api" | "error" }) {
  const { data } = useSeededResource("audit.investigations", rows, source, (d) => d.length === 0);

  return (
    <DataTable<InvestigationSummary & Record<string, unknown>>
      columns={[
        { key: "caseId", label: "Case ID", sortable: true },
        { key: "subject", label: "Subject" },
        { key: "assignedTo", label: "Assigned To" },
        { key: "started", label: "Started", sortable: true },
        { key: "findings", label: "Findings" },
        { key: "status", label: "Status", render: (row) => <StatusPill status={STATUS_LABELS[row.status as InvestigationSummary["status"]] ?? String(row.status)} /> },
      ]}
      rows={data as (InvestigationSummary & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search investigations..."
      pageSize={15}
      exportable
      exportFilename="investigations"
    />
  );
}
