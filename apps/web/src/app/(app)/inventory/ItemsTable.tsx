"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { PredictionBadge } from "@/app/_components/ds/PredictionBadge";
import { formatMoney } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
import type { InventoryItemRow } from "./_data";

type Col = {
  key: keyof InventoryItemRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryItemRow) => ReactNode;
};

const columns: Col[] = [
  { key: "sku", label: "SKU", render: (r) => r.sku ?? "—" },
  { key: "name", label: "Item Name" },
  { key: "category", label: "Category", render: (r) => r.category ?? "—" },
  { key: "uom", label: "Unit", render: (r) => r.uom ?? "—" },
  { key: "itemType", label: "Type" },
  { key: "reorderLevel", label: "Reorder Level", align: "right" },
  { key: "unitCostMinor", label: "Std. Cost", align: "right", render: (r) => formatMoney(r.unitCostMinor) },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
  {
    key: "demandForecast" as keyof InventoryItemRow & string,
    label: "Demand Forecast",
    render: (r) => {
      const pred = (r as Record<string, unknown>).demandForecast as { confidence: number; totalDemand: number; isFallback?: boolean; factors?: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }> } | undefined;
      if (!pred) return null;
      return (
        <PredictionBadge
          confidence={pred.confidence}
          label={`${pred.totalDemand} units`}
          factors={pred.factors}
          isFallback={pred.isFallback}
        />
      );
    },
  },
];

export function ItemsTable({ items, source = "api" }: { items: InventoryItemRow[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<InventoryItemRow[]>(
    "inventory.items",
    items,
    source,
    (d) => d.length === 0,
  );

  const active = rows.filter((i) => i.status === "active").length;
  const consumables = rows.filter((i) => i.itemType === "consumable").length;
  const tracked = rows.filter((i) => i.reorderLevel > 0).length;

  return (
    <div aria-label="Inventory item master">
      <StatGrid>
          <StatCard icon="📦" iconBg="#f1f5f9" label="Total Items" value={statValue(provenance, rows.length)} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={statValue(provenance, active)} />
          <StatCard icon="🧴" iconBg="#faf5ff" label="Consumables" value={statValue(provenance, consumables)} />
          <StatCard icon="🔔" iconBg="#fef3c7" label="Reorder Tracked" value={statValue(provenance, tracked)} />
      </StatGrid>
      <Card title="Items">
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="item master">
          <DataTable<InventoryItemRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter items…"
            pageSize={15}
          />
        </RegisterFrame>
      </Card>
    </div>
  );
}
