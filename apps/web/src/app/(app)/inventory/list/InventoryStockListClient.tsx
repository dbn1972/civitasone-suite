"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/formatters";
import { DataTable, Segmented, EmptyState, Card } from "@/app/_components/ds";

type StockItem = {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number | null;
  minStockLevel: number;
  totalValue: number | null;
  isLowStock: boolean | null;
};

interface Props {
  items: StockItem[];
}

const COLUMNS = [
  { key: "itemCode" as const, label: "Item Code" },
  { key: "name" as const, label: "Item Name" },
  { key: "category" as const, label: "Category" },
  { key: "unit" as const, label: "UOM" },
  { key: "currentStock" as const, label: "On-hand Qty", align: "right" as const, render: (r: { currentStock: number | null }) => (r.currentStock === null ? "—" : r.currentStock) },
  { key: "minStockLevel" as const, label: "Reorder Level", align: "right" as const },
  { key: "totalValue" as const, label: "Value", align: "right" as const, render: (r: { totalValue: number | null }) => formatMoney(r.totalValue) },
  // GAP-INVENTORY-LIST-04: a real text column (not a boolean smuggled through a cast),
  // so the status pill is never colour-only.
  { key: "stockStatus" as const, label: "Status", cellType: "status" as const },
];

const SEG_OPTIONS = ["All items", "Low stock"];

export function InventoryStockListClient({ items }: Props) {
  const [active, setActive] = useState("All items");

  const filtered = active === "Low stock" ? items.filter((i) => i.isLowStock === true) : items;

  const rows: Array<StockItem & { stockStatus: "Low Stock" | "OK" | "Unknown" }> = filtered.map((i) => ({
    ...i,
    stockStatus: i.isLowStock === null ? "Unknown" : i.isLowStock ? "Low Stock" : "OK",
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
          rows={rows}
          rowLinkPrefix="/inventory/"
          rowLinkKey="id"
          identifyingColumnKey="name"
          sortable
          filterable
          filterPlaceholder="Filter stock items…"
          pageSize={15}
        />
      )}
    </Card>
  );
}
