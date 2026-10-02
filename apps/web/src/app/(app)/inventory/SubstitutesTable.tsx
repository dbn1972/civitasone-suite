"use client";

import type { ReactNode } from "react";
import { DataTable, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, isNoData, statValue } from "./RegisterFrame";
import type { InventorySubstituteRow } from "./_data";
import { SUBSTITUTES_ITEM_CAP } from "./substitutesCoverage";

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
  coverage,
}: {
  substitutes: InventorySubstituteRow[];
  source?: "api" | "error";
  /** Loader coverage (GAP-INVENTORY-SUBSTITUTES-02): item cap and partial failures. */
  coverage?: { truncated: boolean; failedCount: number; itemCount: number };
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<InventorySubstituteRow[]>(
    "inventory.substitutes",
    substitutes,
    source,
    (d) => d.length === 0,
  );

  const uniqueItems = new Set(rows.map((s) => s.itemId)).size;
  // GAP-INVENTORY-SUBSTITUTES-01: no links => "—", not a fabricated 0.0.
  const avgPriority =
    isNoData(provenance) || rows.length === 0
      ? null
      : (rows.reduce((s, r) => s + (Number(r.priority) || 0), 0) / rows.length).toFixed(1);

  return (
    <div aria-label="Inventory item substitutes">
      <StatGrid>
          <StatCard icon="🔁" iconBg="#faf5ff" label="Substitute Links" value={statValue(provenance, rows.length)} />
          <StatCard icon="📦" iconBg="#f1f5f9" label="Items Covered" value={statValue(provenance, uniqueItems)} />
          <StatCard icon="⭐" iconBg="#fef3c7" label="Avg Priority" value={avgPriority} />
      </StatGrid>
      <Card title="Substitutes">
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="item substitutes">
          {coverage && (coverage.truncated || coverage.failedCount > 0) ? (
            <p role="status" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
              {coverage.truncated
                ? `Showing substitutes for the first ${SUBSTITUTES_ITEM_CAP} of ${coverage.itemCount} items. `
                : ""}
              {coverage.failedCount > 0
                ? `Substitutes for ${coverage.failedCount} item${coverage.failedCount === 1 ? "" : "s"} could not be loaded. `
                : ""}
              This list may be incomplete — do not treat it as full substitute coverage.
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
        </RegisterFrame>
      </Card>
    </div>
  );
}
