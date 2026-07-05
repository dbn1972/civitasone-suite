"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Scroll = Record<string, unknown>;

export function PFMSTable({ scrolls, source = "api" }: { scrolls: Scroll[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Scroll[]>(
    "finance.pfms.scrolls",
    scrolls,
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
      <DataTable<Scroll>
        columns={[
          { key: "scrollId", label: "Scroll ID" },
          { key: "beneficiary", label: "Beneficiary" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "bankAccount", label: "Bank Account" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "date", label: "Date" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search PFMS scrolls…"
        pageSize={15}
        exportable
        exportFilename="pfms-scrolls"
        emptyIcon="📜"
        emptyTitle="No PFMS scrolls"
        emptyMessage="No payment scrolls found. Scrolls appear when payments are registered with PFMS."
      />
    </>
  );
}
