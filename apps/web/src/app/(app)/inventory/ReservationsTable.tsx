"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<InventoryReservationRow[]>(
    "inventory.reservations",
    reservations,
    source,
    (d) => d.length === 0,
  );

  const active = rows.filter((r) => r.status === "active").length;
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  return (
    <div aria-label="Inventory stock reservations">
      <StatGrid>
          <StatCard icon="🔒" iconBg="#fef3c7" label="Reservations" value={statValue(provenance, rows.length)} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={statValue(provenance, active)} />
          <StatCard icon="🔢" iconBg="#f1f5f9" label="Total Qty Held" value={statValue(provenance, totalQty)} />
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
