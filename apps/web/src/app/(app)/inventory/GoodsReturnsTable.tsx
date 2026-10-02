"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, isNoData, statValue } from "./RegisterFrame";
import type { InventoryGoodsReturnRow } from "./_data";
import { INVENTORY_LIST_LIMIT, capNote } from "./_limits";
import { itemLabel, nameOrDash } from "./_labels";
import { dispositionLabel } from "./goods-returns/[id]/qcMatrix";

type Col = {
  key: keyof InventoryGoodsReturnRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryGoodsReturnRow) => ReactNode;
};

const columns: Col[] = [
  { key: "createdAt", label: "Date", render: (r) => formatIndianDate(r.createdAt) },
  // GAP-INVENTORY-GOODS-RETURNS-02: item and store are named so a QC inspector can
  // tell what is being inspected without opening the row; an unresolvable item
  // falls back to its short id.
  { key: "itemId", label: "Item", render: (r) => <span title={r.itemId}>{itemLabel(r)}</span> },
  { key: "storeId", label: "Store", render: (r) => <span title={r.storeId}>{nameOrDash(r.storeName)}</span> },
  { key: "qty", label: "Qty", align: "right" },
  { key: "reason", label: "Reason" },
  { key: "qcStatus", label: "QC Status", render: (r) => <StatusPill status={r.qcStatus} /> },
  // GAP-INVENTORY-GOODS-RETURNS-DETAIL-02: the same wording as the detail page and the form.
  { key: "disposition", label: "Disposition", render: (r) => <StatusPill status={r.disposition} label={dispositionLabel(r.disposition)} /> },
  { key: "originalIssueId", label: "Issue", render: (r) => <code>{r.originalIssueId.slice(0, 8)}</code> },
];

export function GoodsReturnsTable({
  returns,
  source = "api",
}: {
  returns: InventoryGoodsReturnRow[];
  source?: "api" | "error";
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<InventoryGoodsReturnRow[]>(
    "inventory.goods-returns",
    returns,
    source,
    (d) => d.length === 0,
  );

  const pendingRows = rows.filter((r) => r.qcStatus === "pending");
  const pendingQc = pendingRows.length;
  // GAP-INVENTORY-GOODS-RETURNS-03: a unitless cross-item quantity total is
  // meaningless; show the age of the oldest return still awaiting QC instead.
  const oldestMs = pendingRows.reduce((min, r) => {
    const t = Date.parse(r.createdAt);
    return Number.isNaN(t) ? min : Math.min(min, t);
  }, Number.POSITIVE_INFINITY);
  const oldestPendingDays = isNoData(provenance)
    ? null
    : Number.isFinite(oldestMs)
      ? Math.max(0, Math.floor((Date.now() - oldestMs) / 86_400_000))
      : 0;

  return (
    <div aria-label="Inventory goods returns">
      <StatGrid>
          <StatCard icon="↩️" iconBg="#fee2e2" label="Returns" value={statValue(provenance, rows.length)} />
          <StatCard icon="🔎" iconBg="#fef3c7" label="Pending QC" value={statValue(provenance, pendingQc)} />
          <StatCard icon="⏳" iconBg="#f1f5f9" label="Oldest Pending QC (days)" value={oldestPendingDays} />
      </StatGrid>
      <Card title="Goods Returns">
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="goods returns" capNote={capNote(rows.length, INVENTORY_LIST_LIMIT, "goods returns")}>
          <DataTable<InventoryGoodsReturnRow>
            columns={columns}
            rows={rows}
            rowHref={(row) => `/inventory/goods-returns/${row.id}`}
            sortable
            filterable
            filterPlaceholder="Filter goods returns…"
            pageSize={15}
          />
        </RegisterFrame>
      </Card>
    </div>
  );
}
