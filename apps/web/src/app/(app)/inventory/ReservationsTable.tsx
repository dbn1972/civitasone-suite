"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { InventoryReservationRow } from "./_data";

type Col = {
  key: keyof InventoryReservationRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryReservationRow) => ReactNode;
};

const columns: Col[] = [
  { key: "itemId", label: "Item", render: (r) => <code>{r.itemId.slice(0, 8)}</code> },
  { key: "storeId", label: "Store", render: (r) => <code>{r.storeId.slice(0, 8)}</code> },
  { key: "qty", label: "Qty", align: "right" },
  { key: "refType", label: "Ref Type" },
  { key: "refId", label: "Ref", render: (r) => <code>{r.refId.slice(0, 8)}</code> },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
  { key: "expiresAt", label: "Expires", render: (r) => (r.expiresAt ? formatIndianDate(r.expiresAt) : "—") },
  { key: "createdAt", label: "Created", render: (r) => formatIndianDate(r.createdAt) },
];

export function ReservationsTable({
  reservations,
  source = "api",
}: {
  reservations: InventoryReservationRow[];
  source?: "api" | "error";
}) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<InventoryReservationRow[]>(
    "inventory.reservations",
    reservations,
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
      <DataTable<InventoryReservationRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter reservations…"
        pageSize={15}
      />
    </>
  );
}
