"use client";

import { DataTable } from "@/app/_components/ds";

export type DprRow = {
  dprNo: string;
  projectTitle: string;
  submittedBy: string;
  submittedDate: string;
  estimatedCost: string;
  status: string;
  reviewingAuthority: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof DprRow & string;
  label: string;
  cellType?: "status" | "amount";
}[] = [
  { key: "dprNo", label: "DPR No" },
  { key: "projectTitle", label: "Project Title" },
  { key: "submittedBy", label: "Submitted By" },
  { key: "submittedDate", label: "Submitted Date" },
  { key: "estimatedCost", label: "Estimated Cost (₹ Cr)" },
  { key: "status", label: "Status", cellType: "status" },
  { key: "reviewingAuthority", label: "Reviewing Authority" },
];

export function DprTrackingTable({ rows }: { rows: DprRow[] }) {
  return (
    <DataTable<DprRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter DPRs…"
      pageSize={15}
    />
  );
}
