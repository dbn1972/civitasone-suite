"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Transfer = Record<string, unknown>;

export function EFTTable({ transfers, source = "api" }: { transfers: Transfer[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Transfer[]>(
    "finance.eft.transfers",
    transfers,
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
      <DataTable<Transfer>
        columns={[
          { key: "utr", label: "UTR / Reference" },
          { key: "beneficiary", label: "Beneficiary" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "mode", label: "Mode" },
          { key: "initiatedDate", label: "Initiated" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search transfers…"
        pageSize={15}
        exportable
        exportFilename="eft-transfers"
        emptyIcon="⚡"
        emptyTitle="No EFT transfers"
        emptyMessage="No electronic fund transfers found."
      />
    </>
  );
}
