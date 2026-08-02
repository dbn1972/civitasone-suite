"use client";

import type { ReactNode } from "react";
import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { InventorySubstituteRow } from "./_data";

type Col = {
  key: keyof InventorySubstituteRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventorySubstituteRow) => ReactNode;
};

const columns: Col[] = [
  { key: "itemId", label: "Item", render: (r) => <code>{r.itemId.slice(0, 8)}</code> },
  { key: "substituteId", label: "Substitute", render: (r) => <code>{r.substituteId.slice(0, 8)}</code> },
  { key: "priority", label: "Priority", align: "right" },
  { key: "conversionFactor", label: "Conversion", align: "right" },
  { key: "createdAt", label: "Created", render: (r) => formatIndianDate(r.createdAt) },
];

export function SubstitutesTable({
  substitutes,
  source = "api",
}: {
  substitutes: InventorySubstituteRow[];
  source?: "api" | "error";
}) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<InventorySubstituteRow[]>(
    "inventory.substitutes",
    substitutes,
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
      <DataTable<InventorySubstituteRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Filter substitutes…"
        pageSize={15}
      />
    </>
  );
}
