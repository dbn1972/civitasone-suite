"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { InventoryGoodsReturnRow } from "./_data";

type Col = {
  key: keyof InventoryGoodsReturnRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryGoodsReturnRow) => ReactNode;
};

const columns: Col[] = [
  { key: "createdAt", label: "Date", render: (r) => formatIndianDate(r.createdAt) },
  { key: "itemId", label: "Item", render: (r) => <code>{r.itemId.slice(0, 8)}</code> },
  { key: "storeId", label: "Store", render: (r) => <code>{r.storeId.slice(0, 8)}</code> },
  { key: "qty", label: "Qty", align: "right" },
  { key: "reason", label: "Reason" },
  { key: "qcStatus", label: "QC Status", render: (r) => <StatusPill status={r.qcStatus} /> },
  { key: "disposition", label: "Disposition", render: (r) => <StatusPill status={r.disposition} /> },
  { key: "originalIssueId", label: "Issue", render: (r) => <code>{r.originalIssueId.slice(0, 8)}</code> },
];

export function GoodsReturnsTable({
  returns,
  source = "api",
}: {
  returns: InventoryGoodsReturnRow[];
  source?: "api" | "error";
}) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<InventoryGoodsReturnRow[]>(
    "inventory.goods-returns",
    returns,
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
      <DataTable<InventoryGoodsReturnRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter goods returns…"
        pageSize={15}
      />
    </>
  );
}
