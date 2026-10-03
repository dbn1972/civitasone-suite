"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
import type { InventoryBinRow } from "./_data";
import { INVENTORY_LIST_LIMIT, capNote } from "./_limits";
import { nameOrDash } from "./_labels";
import { BinStatusAction } from "./BinStatusAction";

type Col = {
  key: keyof InventoryBinRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryBinRow) => ReactNode;
};

const baseColumns: Col[] = [
  { key: "code", label: "Bin Code" },
  // GAP-INVENTORY-BINS-02: the store's name, never an id fragment; the full id
  // stays available as a tooltip and a bin whose store could not be named shows "—".
  { key: "storeId", label: "Store", render: (r) => <span title={r.storeId}>{nameOrDash(r.storeName)}</span> },
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

export function BinsTable({
  bins,
  source = "api",
  canManage = false,
}: {
  bins: InventoryBinRow[];
  source?: "api" | "error";
  /** Show the activate/deactivate control (inventory manager roles only; the service re-checks). */
  canManage?: boolean;
}) {
  const router = useRouter();
  const { data: seeded, provenance, offline, cachedAt } = useSeededResource<InventoryBinRow[]>(
    "inventory.bins",
    bins,
    source,
    (d) => d.length === 0,
  );
  // The seeded copy is fixed at mount, so a confirmed status change is layered on top locally.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const rows = seeded.map((b) => (b.id in overrides ? { ...b, isActive: overrides[b.id]! } : b));

  const columns: Col[] = canManage
    ? [
        ...baseColumns,
        {
          key: "id",
          label: "Actions",
          render: (r) => (
            <BinStatusAction
              binId={r.id}
              code={r.code}
              isActive={r.isActive}
              onChanged={(id, isActive, confirmed) => {
                if (confirmed) setOverrides((p) => ({ ...p, [id]: isActive }));
                router.refresh();
              }}
            />
          ),
        },
      ]
    : baseColumns;

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
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="bins and racks" capNote={capNote(rows.length, INVENTORY_LIST_LIMIT, "bins")}>
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
