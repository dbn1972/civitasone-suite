"use client";
import { useState } from "react";
import { DataTable } from "@/app/_components/ds";
import { Segmented } from "@/app/_components/ds";
import { EmptyState } from "@/app/_components/ds";

interface StockItem {
  id: string;
  itemCode: string;
  name: string;
  unit: string;
  currentStock: number;
  totalValue: number;
  isLowStock: boolean;
  category: string;
}

interface Props {
  items: StockItem[];
}

const COLUMNS = [
  { key: "itemCode" as const, label: "Item code" },
  { key: "name" as const, label: "Name" },
  { key: "unit" as const, label: "UOM" },
  { key: "currentStock" as const, label: "On-hand qty", align: "right" as const },
  { key: "totalValue" as const, label: "Value ₹", align: "right" as const, cellType: "amount" as const },
  { key: "isLowStock" as const, label: "Status", cellType: "status" as const },
];

const SEG_OPTIONS = ["All", "Low stock"];

export function StockListClient({ items }: Props) {
  const [active, setActive] = useState("All");

  const filtered = active === "Low stock" ? items.filter((i) => i.isLowStock) : items;

  // Normalise rows so cellType:"status" renders the label, cellType:"amount" gets paise value
  const rows = filtered.map((i) => ({
    ...i,
    isLowStock: (i.isLowStock ? "Low Stock" : "OK") as unknown as boolean,
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
          rowLinkPrefix="/stock/"
          rowLinkKey="id"
          sortable
          filterable
          pageSize={15}
        />
      )}
    </div>
  );
}
