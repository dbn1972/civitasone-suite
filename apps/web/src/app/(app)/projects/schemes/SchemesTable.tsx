"use client";

import { DataTable } from "@/app/_components/ds";
import { formatRupees } from "@/lib/formatters";
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
    // COMP-017: totalAllocation/releasedAmount come from project-service's
    // listSchemeSummaries(), which deliberately returns whole-RUPEE numbers
    // (its minorToAmount() helper) -- see SchemeSummarySchema in
    // packages/schemas/src/web.ts (`totalAllocation: z.number()`) and the
    // "Deliberately NOT SchemeSummary & {...}" comment on SchemeDetail in
    // packages/types/src/index.ts, which documents this as the list
    // response's own settled convention, distinct from the detail
    // response's minor-unit-string one. formatMoney() expects MINOR units
    // (paise) per its own docstring and was under-displaying every
    // allocation/released figure here 100x. formatRupees() is this repo's
    // existing formatter for exactly this "API field already in rupees"
    // convention (see its docstring and apps/web/src/lib/formatters.test.ts).
    key: "totalAllocation",
    label: "Allocation",
    align: "right",
    render: (r) => formatRupees(r.totalAllocation as number),
  },
  {
    key: "releasedAmount",
    label: "Released",
    align: "right",
    render: (r) => formatRupees(r.releasedAmount as number),
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
      // COMP-016: rows had no way to reach /projects/schemes/[id] at all until
      // now -- that page previously only ever rendered a hardcoded catalogue,
      // so linking to it was pointless. Now that it renders the real scheme,
      // wire the real per-tenant id straight through.
      rowHref={(r) => `/projects/schemes/${r.id}`}
      // UX-015: column 0 is schemeCode (an internal reference), not the
      // scheme's own name -- name the row link after the scheme, not its code.
      identifyingColumnKey="name"
    />
  );
}
