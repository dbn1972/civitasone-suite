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
    // GAP2-PROJECTS-SCHEMES-MONEY-04: totalAllocation/releasedAmount are now
    // bigint MINOR units (paise) as a string from listSchemeSummaries, same as
    // the detail endpoint — rendered with formatMoney (paise) uniformly. The
    // previous whole-rupee + formatRupees workaround (COMP-017) is gone now
    // that list and detail share one unit convention.
    key: "totalAllocation",
    label: "Allocation",
    align: "right",
    render: (r) => formatMoney(r.totalAllocation),
  },
  {
    key: "releasedAmount",
    label: "Released",
    align: "right",
    render: (r) => formatMoney(r.releasedAmount),
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
