"use client";

import { DataTable } from "@/app/_components/ds";
import { formatCrore, formatPercent } from "@/lib/formatters";

// GAP-PROJECTS-UTILIZATION-03: money fields are MINOR-unit (paise) strings —
// the single platform convention — not pre-formatted "₹ Cr" display strings.
// They are rendered as crore via formatCrore() and the percentage via
// formatPercent(); utilisationPct is a number so the table sorts it
// numerically rather than as text.
export type UtilizationRow = {
  project: string;
  allocatedMinor: string;
  releasedMinor: string;
  utilisedMinor: string;
  utilisationPct: number | null;
  status: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof UtilizationRow & string;
  label: string;
  cellType?: "status" | "amount";
  align?: "left" | "right" | "center";
  render?: (row: UtilizationRow) => React.ReactNode;
}[] = [
  { key: "project", label: "Project" },
  { key: "allocatedMinor", label: "Allocated (₹ Cr)", align: "right", render: (r) => formatCrore(r.allocatedMinor) },
  { key: "releasedMinor", label: "Released (₹ Cr)", align: "right", render: (r) => formatCrore(r.releasedMinor) },
  { key: "utilisedMinor", label: "Utilized (₹ Cr)", align: "right", render: (r) => formatCrore(r.utilisedMinor) },
  { key: "utilisationPct", label: "Utilization %", align: "right", render: (r) => formatPercent(r.utilisationPct) },
  { key: "status", label: "Status", cellType: "status" },
];

export function UtilizationTable({ rows }: { rows: UtilizationRow[] }) {
  return (
    <DataTable<UtilizationRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter projects…"
      pageSize={15}
    />
  );
}
