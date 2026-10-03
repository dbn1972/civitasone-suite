"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { useTranslations } from "next-intl";
import { RegisterFrame, statValue } from "./RegisterFrame";
import { linkState } from "./linkHelpers";
import type { InventoryItemRow } from "./_data";
import { INVENTORY_LIST_LIMIT, capNote } from "./_limits";

/** `linkState` holds the badge TEXT, so the column's filter, sort and CSV use what the user reads. */
type Row = InventoryItemRow & { linkState: string };
type Col = {
  key: keyof Row & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: Row) => ReactNode;
};

const columns: Col[] = [
  { key: "sku", label: "SKU", render: (r) => r.sku ?? "—" },
  { key: "name", label: "Item Name" },
  { key: "category", label: "Category", render: (r) => r.category ?? "—" },
  { key: "uom", label: "Unit", render: (r) => r.uom ?? "—" },
  { key: "itemType", label: "Type" },
  { key: "reorderLevel", label: "Reorder Level", align: "right" },
  { key: "reorderQty", label: "Reorder Qty", align: "right" },
  { key: "unitCostMinor", label: "Std. Cost", align: "right", render: (r) => formatMoney(r.unitCostMinor) },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
];

/**
 * `linkedItemIds` are the item master ids that are linked to a stock register item; null when the
 * links could not be loaded (then no row claims to be linked or unlinked).
 */
export function ItemsTable({
  items, source = "api", linkedItemIds = null,
}: { items: InventoryItemRow[]; source?: "api" | "error"; linkedItemIds?: string[] | null }) {
  const t = useTranslations("inventoryLink");
  const linked = linkedItemIds === null ? null : new Set(linkedItemIds);
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<InventoryItemRow[]>(
    "inventory.items",
    items,
    source,
    (d) => d.length === 0,
  );

  const columnsWithLink: Col[] = [
    ...columns.slice(0, -1),
    {
      key: "linkState",
      label: t("badge.column"),
      render: (r) => <StatusPill status={r.linkState === t("badge.linked") ? "active" : "info"} label={r.linkState} />,
    },
    columns[columns.length - 1]!,
  ];
  const tableRows: Row[] = rows.map((r) => ({ ...r, linkState: t(`badge.${linkState(r.id, linked)}`) }));
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
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="item master" capNote={capNote(rows.length, INVENTORY_LIST_LIMIT, "items")}>
          <DataTable<Row>
            columns={columnsWithLink}
            rows={tableRows}
            rowLinkPrefix="/inventory/items/"
            rowLinkKey="id"
            identifyingColumnKey="name"
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
