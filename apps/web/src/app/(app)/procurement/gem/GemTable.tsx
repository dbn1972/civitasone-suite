"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { GemItem } from "../../../_data/loaders";

type GemRow = {
  id: string;
  orderId: string;
  item: string;
  supplier: string;
  amount: string;
  deliveryDate: string;
  gemStatus: string;
} & Record<string, unknown>;

export function GemTable({ items, source = "api" }: { items: GemItem[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GemItem[]>(
    "procurement.gem",
    items,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<GemRow[]>(
    () =>
      rows.map((g) => ({
        id: g.id,
        orderId: g.orderId,
        item: g.item,
        supplier: g.supplier,
        amount: `₹${(g.amount / 100).toLocaleString("en-IN")}`,
        deliveryDate: g.deliveryDate,
        gemStatus: g.gemStatus,
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="GeM Orders">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="🛒" title="No GeM orders found" message="Orders placed on GeM will appear here." />
      ) : (
        <DataTable<GemRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Search order ID, item, supplier…"
          pageSize={15}
          exportable
          exportFilename="gem-orders"
          columns={[
            { key: "orderId", label: "GeM Order ID" },
            { key: "item", label: "Item" },
            { key: "supplier", label: "Supplier" },
            { key: "amount", label: "Amount (₹)", align: "right" },
            { key: "deliveryDate", label: "Delivery Date" },
            { key: "gemStatus", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
