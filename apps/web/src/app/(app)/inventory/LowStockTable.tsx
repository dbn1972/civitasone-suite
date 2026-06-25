"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { InventoryLowStockRow } from "./_data";

type Col = {
  key: keyof InventoryLowStockRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryLowStockRow) => ReactNode;
};

const columns: Col[] = [
  { key: "sku", label: "SKU", render: (r) => r.sku ?? "—" },
  { key: "name", label: "Item Name" },
  { key: "onHandQty", label: "On Hand", align: "right" },
  { key: "reorderLevel", label: "Reorder Level", align: "right" },
  { key: "suggestedReorderQty", label: "Suggested Reorder", align: "right" },
  { key: "itemId", label: "Status", render: () => <StatusPill status="breached" label="LOW" /> },
];

export function LowStockTable({ rows: initial, source = "api" }: { rows: InventoryLowStockRow[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<InventoryLowStockRow[]>(
    "inventory.low-stock",
    initial,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${formatIndianDate(new Date(cachedAt).toISOString())}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<InventoryLowStockRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter low-stock items…"
        pageSize={15}
      />
    </>
  );
}
