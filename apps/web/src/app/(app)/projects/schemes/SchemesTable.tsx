"use client";

import { DataTable } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import type { SchemeSummary } from "@civitasone/types";

export type SchemeRow = SchemeSummary & Record<string, unknown>;

const COLUMNS: {
  key: keyof SchemeRow & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  render?: (row: SchemeRow) => React.ReactNode;
}[] = [
  { key: "schemeCode", label: "Scheme Code" },
  { key: "name", label: "Name" },
  {
    key: "ministry",
    label: "Ministry / Dept",
    render: (r) => (r.ministry as string | undefined) ?? (r.department as string | undefined) ?? "—",
  },
  { key: "fundingType", label: "Funding Type" },
  {
    key: "totalAllocation",
    label: "Allocation",
    align: "right",
    render: (r) => formatMoney(r.totalAllocation as number),
  },
  {
    key: "releasedAmount",
    label: "Released",
    align: "right",
    render: (r) => formatMoney(r.releasedAmount as number),
  },
  { key: "projectCount", label: "Projects #", align: "right" },
  { key: "status", label: "Status", cellType: "status" },
];

export function SchemesTable({ rows }: { rows: SchemeRow[] }) {
  return (
    <DataTable<SchemeRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter schemes…"
      pageSize={15}
    />
  );
}
