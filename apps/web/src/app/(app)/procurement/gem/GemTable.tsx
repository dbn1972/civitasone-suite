"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GemItem[]>(
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

  return (
    <Card title="GeM Orders">
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge
        provenance={provenance ?? "live"}
        cachedAt={cachedAt}
        offline={offline}
        message={provenance === "error-no-data" ? "Couldn't load — showing nothing" : undefined}
      />
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
