"use client";

import { DataTable } from "@/app/_components/ds";

export type UtilizationRow = {
  project: string;
  allocated: string;
  released: string;
  utilized: string;
  utilizationPct: string;
  status: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof UtilizationRow & string;
  label: string;
  cellType?: "status" | "amount";
  align?: "left" | "right" | "center";
}[] = [
  { key: "project", label: "Project" },
  { key: "allocated", label: "Allocated (₹ Cr)", align: "right" },
  { key: "released", label: "Released (₹ Cr)", align: "right" },
  { key: "utilized", label: "Utilized (₹ Cr)", align: "right" },
  { key: "utilizationPct", label: "Utilization %", align: "right" },
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
