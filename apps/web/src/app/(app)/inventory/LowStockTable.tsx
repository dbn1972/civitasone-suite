"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
import type { InventoryLowStockRow } from "./_data";
import { lowStockSeverity, nameOrDash, raiseIndentHref } from "./_labels";

/** The row plus a render-only `action` column, which has no data of its own. */
type Row = InventoryLowStockRow & { action?: never };

type Col = {
  key: keyof Row & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: Row) => ReactNode;
};

const columns: Col[] = [
  { key: "sku", label: "SKU", render: (r) => r.sku ?? "—" },
  {
    key: "name",
    label: "Item Name",
    // GAP-INVENTORY-LOW-STOCK-03: the item detail page is one click away.
    render: (r) => <Link href={`/inventory/${r.itemId}`}>{r.name}</Link>,
  },
  { key: "storeName", label: "Store", render: (r) => <span title={r.storeId}>{nameOrDash(r.storeName)}</span> },
  { key: "onHandQty", label: "On Hand", align: "right" },
  { key: "reorderLevel", label: "Reorder Level", align: "right" },
  { key: "suggestedReorderQty", label: "Suggested Reorder", align: "right" },
  {
    key: "itemId",
    label: "Status",
    // Severity from the row, not a constant "LOW" pill.
    render: (r) => {
      const sev = lowStockSeverity(r.onHandQty, r.reorderLevel);
      return <StatusPill status="breached" label={sev.label} variant={sev.variant} />;
    },
  },
  {
    key: "action",
    label: "Action",
    render: (r) => <Link href={raiseIndentHref(r)}>Raise indent</Link>,
  },
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
          <DataTable<Row>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter low-stock items…"
            emptyIcon="✅"
            emptyTitle="No items below reorder level"
            emptyMessage="Every stocked item is above its reorder level."
            pageSize={15}
          />
        </RegisterFrame>
      </Card>
    </div>
  );
}
