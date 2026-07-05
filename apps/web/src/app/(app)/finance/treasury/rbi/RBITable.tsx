"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Investment = Record<string, unknown>;

export function RBITable({ investments, source = "api" }: { investments: Investment[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Investment[]>(
    "finance.rbi.investments",
    investments,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Investment>
        columns={[
          { key: "instrumentId", label: "Instrument" },
          { key: "type", label: "Type" },
          { key: "faceValue", label: "Face Value", align: "right" },
          { key: "maturityDate", label: "Maturity" },
          { key: "interestRate", label: "Rate (%)", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search investments…"
        pageSize={15}
        exportable
        exportFilename="rbi-investments"
        emptyIcon="🏦"
        emptyTitle="No investments"
        emptyMessage="No treasury investments found."
      />
    </>
  );
}
