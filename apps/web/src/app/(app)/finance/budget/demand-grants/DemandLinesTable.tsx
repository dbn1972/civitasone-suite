"use client";

import { DataTable } from "@/app/_components/ds";
import type { DemandLine } from "./demandDetail";

/** Head-wise lines of a demand (GAP-FINANCE-BUDGET-DEMAND-GRANTS-04). A client component because DataTable's render props cannot cross the server boundary. */
export function DemandLinesTable({ lines }: { lines: DemandLine[] }) {
  return (
    <DataTable<DemandLine>
      columns={[
        { key: "headCode", label: "Major head" },
        { key: "headName", label: "Name", render: (l) => l.headName ?? "—" },
        { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
      ]}
      rows={lines}
      pageSize={15}
      emptyIcon="🧮"
      emptyTitle="No head-wise lines yet"
      emptyMessage="No head-wise split has been recorded for this demand."
    />
  );
}
