"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { PredictionBadge } from "@/app/_components/ds/PredictionBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { InventoryItemRow } from "./_data";

type Col = {
  key: keyof InventoryItemRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryItemRow) => ReactNode;
};

const columns: Col[] = [
  { key: "sku", label: "SKU", render: (r) => r.sku ?? "—" },
  { key: "name", label: "Item Name" },
  { key: "category", label: "Category", render: (r) => r.category ?? "—" },
  { key: "uom", label: "Unit", render: (r) => r.uom ?? "—" },
  { key: "itemType", label: "Type" },
  { key: "reorderLevel", label: "Reorder Level", align: "right" },
  { key: "unitCostMinor", label: "Std. Cost", align: "right", render: (r) => formatMoney(r.unitCostMinor) },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
  {
    key: "demandForecast" as keyof InventoryItemRow & string,
    label: "Demand Forecast",
    render: (r) => {
      const pred = (r as Record<string, unknown>).demandForecast as { confidence: number; totalDemand: number; isFallback?: boolean; factors?: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }> } | undefined;
      if (!pred) return null;
      return (
        <PredictionBadge
          confidence={pred.confidence}
          label={`${pred.totalDemand} units`}
          factors={pred.factors}
          isFallback={pred.isFallback}
        />
      );
    },
  },
];

export function ItemsTable({ items, source = "api" }: { items: InventoryItemRow[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<InventoryItemRow[]>(
    "inventory.items",
    items,
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
      <DataTable<InventoryItemRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter items…"
        pageSize={15}
      />
    </>
  );
}
