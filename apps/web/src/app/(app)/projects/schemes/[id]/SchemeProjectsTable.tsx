"use client";

import { DataTable } from "@/app/_components/ds";

export type SchemeProjectRow = {
  name: string;
  district: string;
  status: string;
  budget: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof SchemeProjectRow & string;
  label: string;
  cellType?: "status" | "amount";
}[] = [
  { key: "name", label: "Project Name" },
  { key: "district", label: "District" },
  { key: "status", label: "Status", cellType: "status" },
  { key: "budget", label: "Budget (₹ Cr)" },
];

export function SchemeProjectsTable({ rows }: { rows: SchemeProjectRow[] }) {
  return (
    <DataTable<SchemeProjectRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter projects…"
    />
  );
}
