"use client";

import { DataTable } from "@/app/_components/ds";

export type EscalationRow = {
  escalationId: string;
  project: string;
  issue: string;
  severity: string;
  escalatedTo: string;
  raisedDate: string;
  status: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof EscalationRow & string;
  label: string;
  cellType?: "status" | "amount";
}[] = [
  { key: "escalationId", label: "Escalation ID" },
  { key: "project", label: "Project" },
  { key: "issue", label: "Issue" },
  { key: "severity", label: "Severity", cellType: "status" },
  { key: "escalatedTo", label: "Escalated To" },
  { key: "raisedDate", label: "Raised Date" },
  { key: "status", label: "Status", cellType: "status" },
];

export function EscalationsTable({ rows }: { rows: EscalationRow[] }) {
  return (
    <DataTable<EscalationRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter escalations…"
      pageSize={15}
    />
  );
}
