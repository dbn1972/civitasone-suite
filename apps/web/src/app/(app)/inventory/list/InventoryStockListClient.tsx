"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState, Card } from "@/app/_components/ds";

interface StockItem {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minStockLevel: number;
  totalValue: number;
  isLowStock: boolean;
}

interface Props {
  items: StockItem[];
}

const COLUMNS = [
  { key: "itemCode" as const, label: "Item Code" },
  { key: "name" as const, label: "Item Name" },
  { key: "category" as const, label: "Category" },
  { key: "unit" as const, label: "UOM" },
  { key: "currentStock" as const, label: "On-hand Qty", align: "right" as const },
  { key: "minStockLevel" as const, label: "Reorder Level", align: "right" as const },
  { key: "totalValue" as const, label: "Value", align: "right" as const, cellType: "amount" as const },
  { key: "isLowStock" as const, label: "Status", cellType: "status" as const },
];

const SEG_OPTIONS = ["All items", "Low stock"];

export function InventoryStockListClient({ items }: Props) {
  const [active, setActive] = useState("All items");

  const filtered = active === "Low stock" ? items.filter((i) => i.isLowStock) : items;

  // Map isLowStock to a textual status so cellType:"status" renders a non-colour-only pill.
  const rows = filtered.map((i) => ({
    ...i,
    isLowStock: (i.isLowStock ? "Low Stock" : "OK") as unknown as boolean,
  }));

  return (
    <Card
      title="Stock register"
      link={
        <div role="group" aria-label="Filter by stock status">
          <Segmented value={active} onChange={setActive} options={SEG_OPTIONS} />
        </div>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No stock items found"
          message="Add stock items to track inventory levels."
        />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows as unknown as Record<string, unknown>[]}
          rowLinkPrefix="/stock/"
          rowLinkKey="id"
          sortable
          filterable
          filterPlaceholder="Filter stock items…"
          pageSize={15}
        />
      )}
    </Card>
  );
}
