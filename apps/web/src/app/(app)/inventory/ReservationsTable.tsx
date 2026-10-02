"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
import type { InventoryReservationRow } from "./_data";
import { isActiveReservation, itemLabel } from "./_labels";

type Col = {
  key: keyof InventoryReservationRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryReservationRow) => ReactNode;
};

const columns: Col[] = [
  // GAP-INVENTORY-RESERVATIONS-03: item by name/SKU (short id only as a fallback), linked to its detail page.
  { key: "itemId", label: "Item", render: (r) => <Link href={`/inventory/${r.itemId}`} title={r.itemId}>{itemLabel(r)}</Link> },
  { key: "storeId", label: "Store", render: (r) => (r.storeName ? <span title={r.storeId}>{r.storeName}</span> : <code title={r.storeId}>{r.storeId.slice(0, 8)}</code>) },
  { key: "qty", label: "Qty", align: "right" },
  { key: "refType", label: "Ref Type" },
  { key: "refId", label: "Ref", render: (r) => <code title={r.refId}>{r.refId.slice(0, 8)}</code> },
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<InventoryReservationRow[]>(
    "inventory.reservations",
    reservations,
    source,
    (d) => d.length === 0,
  );

  // GAP-INVENTORY-RESERVATIONS-02: held quantity counts only reservations that
  // are actually holding stock, with the same predicate as the Active stat.
  const activeRows = rows.filter(isActiveReservation);
  const active = activeRows.length;
  const totalQty = activeRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  return (
    <div aria-label="Inventory stock reservations">
      <StatGrid>
          <StatCard icon="🔒" iconBg="#fef3c7" label="Reservations" value={statValue(provenance, rows.length)} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={statValue(provenance, active)} />
          <StatCard icon="🔢" iconBg="#f1f5f9" label="Qty Held (active)" value={statValue(provenance, totalQty)} />
      </StatGrid>
      <Card title="Reservations">
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="stock reservations">
          <DataTable<InventoryReservationRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter reservations…"
            pageSize={15}
          />
        </RegisterFrame>
      </Card>
    </div>
  );
}
