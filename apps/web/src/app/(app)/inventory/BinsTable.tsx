"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<InventoryBinRow[]>(
    "inventory.bins",
    bins,
    source,
    (d) => d.length === 0,
  );

  const active = rows.filter((b) => b.isActive).length;
  const withCapacity = rows.filter((b) => b.capacity != null && b.capacity > 0).length;

  return (
    <div aria-label="Inventory bins and racks">
      <StatGrid>
          <StatCard icon="🗄️" iconBg="#f1f5f9" label="Total Bins" value={statValue(provenance, rows.length)} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={statValue(provenance, active)} />
          <StatCard icon="📐" iconBg="#fef3c7" label="Capacity Tracked" value={statValue(provenance, withCapacity)} />
      </StatGrid>
      <Card title="Bins">
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="bins and racks">
          <DataTable<InventoryBinRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter bins…"
            pageSize={15}
          />
        </RegisterFrame>
      </Card>
    </div>
  );
}
