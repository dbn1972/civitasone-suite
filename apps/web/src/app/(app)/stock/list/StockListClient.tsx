"use client";
import { useState } from "react";
import { DataTable } from "@/app/_components/ds";
import { Segmented } from "@/app/_components/ds";
import { EmptyState } from "@/app/_components/ds";

interface StockItem {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number | null;
  totalValue: number | null;
  isLowStock: boolean | null;
  /** GAP-STOCK-LIST-03: 'out' | 'low' | 'ok' | 'unknown' */
  stockStatus: "out" | "low" | "ok" | "unknown";
}

interface Props {
  items: StockItem[];
}

// GAP-STOCK-LIST-06: use a typed statusLabel string field instead of casting boolean to string.
// GAP-STOCK-LIST-07: category column added.
const COLUMNS = [
  { key: "itemCode" as const, label: "Item code" },
  { key: "name" as const, label: "Name" },
  { key: "category" as const, label: "Category" },
  { key: "unit" as const, label: "UOM" },
  { key: "currentStock" as const, label: "On-hand qty", align: "right" as const },
  { key: "totalValue" as const, label: "Value ₹", align: "right" as const, cellType: "amount" as const },
  {
    key: "statusLabel" as const, label: "Status", cellType: "status" as const,
    // GAP-STOCK-LIST-06: explicit labels so StatusPill shows the intended display text.
    statusLabels: {
      "Out of stock": "Out of stock",
      "Low stock": "Low stock",
      "OK": "OK",
      "Unknown": "Unknown",
    },
    statusVariants: {
      "Out of stock": "bad" as const,
      "Low stock": "warn" as const,
      "OK": "good" as const,
      "Unknown": "mut" as const,
    },
  },
];

const SEG_OPTIONS = ["All", "Low stock", "Out of stock"];

function stockLabel(status: StockItem["stockStatus"]): string {
  switch (status) {
    case "out": return "Out of stock";
    case "low": return "Low stock";
    case "ok": return "OK";
    default: return "Unknown";
  }
}

export function StockListClient({ items }: Props) {
  const [active, setActive] = useState("All");

  const filtered =
    active === "Low stock" ? items.filter((i) => i.stockStatus === "low")
    : active === "Out of stock" ? items.filter((i) => i.stockStatus === "out")
    : items;

  // GAP-STOCK-LIST-06: statusLabel is a proper string; no `as unknown as boolean` cast.
  const rows = filtered.map((i) => ({
    ...i,
    statusLabel: stockLabel(i.stockStatus),
  }));

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>Stock register</h3>
        <div role="group" aria-label="Filter by stock status">
          <Segmented value={active} onChange={setActive} options={SEG_OPTIONS} />
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState icon="📦" title="No stock items found" message="Add stock items to track inventory levels." />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows as unknown as Record<string, unknown>[]}
          rowLinkPrefix="/inventory/"
          rowLinkKey="id"
          identifyingColumnKey="name"
          sortable
          filterable
          pageSize={15}
        />
      )}
    </div>
  );
}
