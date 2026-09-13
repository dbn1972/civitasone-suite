"use client";

import { DataTable } from "@/app/_components/ds";

// COMP-016: was `district: string`, populated from a hardcoded catalogue.
// project_projects has no district/location column at all (verified against
// project/schema.ts) -- there is no real per-project district anywhere in
// project-service today. Swapped for `code` (projectProjects.code), a real
// column, rather than either inventing per-row district values or shipping a
// column that would always render "--".
export type SchemeProjectRow = {
  name: string;
  code: string;
  status: string;
  budget: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof SchemeProjectRow & string;
  label: string;
  cellType?: "status" | "amount";
}[] = [
  { key: "name", label: "Project Name" },
  { key: "code", label: "Project Code" },
  { key: "status", label: "Status", cellType: "status" },
  // cellType:"amount" formats the raw value via formatMoney() -- `budget`
  // must be a minor-unit numeric string (see page.tsx), never a
  // pre-formatted "₹NNN Cr" string (formatMoney would render that as "—").
  { key: "budget", label: "Budget", cellType: "amount" },
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
