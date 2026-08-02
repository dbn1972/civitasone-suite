"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { InventoryBinRow } from "./_data";

type Col = {
  key: keyof InventoryBinRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryBinRow) => ReactNode;
};

const columns: Col[] = [
  { key: "code", label: "Bin Code" },
  { key: "storeId", label: "Store", render: (r) => <code>{r.storeId.slice(0, 8)}</code> },
  { key: "aisle", label: "Aisle", render: (r) => r.aisle ?? "—" },
  { key: "rack", label: "Rack", render: (r) => r.rack ?? "—" },
  { key: "shelf", label: "Shelf", render: (r) => r.shelf ?? "—" },
  { key: "capacity", label: "Capacity", align: "right", render: (r) => (r.capacity == null ? "—" : r.capacity) },
  {
    key: "isActive",
    label: "Status",
    render: (r) => <StatusPill status={r.isActive ? "active" : "inactive"} label={r.isActive ? "Active" : "Inactive"} />,
  },
  { key: "createdAt", label: "Created", render: (r) => formatIndianDate(r.createdAt) },
];

export function BinsTable({ bins, source = "api" }: { bins: InventoryBinRow[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<InventoryBinRow[]>(
    "inventory.bins",
    bins,
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
      <DataTable<InventoryBinRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter bins…"
        pageSize={15}
      />
    </>
  );
}
