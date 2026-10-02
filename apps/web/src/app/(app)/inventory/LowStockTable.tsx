"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<InventoryLowStockRow[]>(
    "inventory.low-stock",
    initial,
    source,
    (d) => d.length === 0,
  );

  const totalSuggested = rows.reduce((s, r) => s + r.suggestedReorderQty, 0);

  return (
    <div aria-label="Inventory low stock and reorder">
      <StatGrid>
          <StatCard icon="⚠️" iconBg="#fee2e2" label="Items Low" value={statValue(provenance, rows.length)} />
          <StatCard icon="🛒" iconBg="#fef3c7" label="Total Suggested Reorder" value={statValue(provenance, totalSuggested)} />
      </StatGrid>
      <Card title="Low Stock Items">
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="low-stock alerts">
          <DataTable<InventoryLowStockRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter low-stock items…"
            pageSize={15}
          />
        </RegisterFrame>
      </Card>
    </div>
  );
}
