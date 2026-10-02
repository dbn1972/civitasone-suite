"use client";

import type { ReactNode } from "react";
import { DataTable, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
import type { InventoryLedgerRow } from "./_data";
import { INVENTORY_LEDGER_LIMIT, capNote } from "./_limits";
import { itemLabel, nameOrDash } from "./_labels";

type Col = {
  key: keyof InventoryLedgerRow & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: InventoryLedgerRow) => ReactNode;
};

/**
 * Shared movement-ledger table used by the Receipts and Issues screens.
 * `kind` filters the ledger to a single movement type and drives the qty column.
 */
export function MovementsTable({
  entries,
  kind,
  source = "api",
}: {
  entries: InventoryLedgerRow[];
  kind: "receipt" | "issue";
  source?: "api" | "error";
}) {
  const { data: all, provenance, offline, cachedAt } = useSeededResource<InventoryLedgerRow[]>(
    `inventory.ledger.${kind}`,
    entries,
    source,
    (d) => d.length === 0,
  );

  const rows = all.filter((r) => r.movementType === kind);
  // GAP-INVENTORY-ISSUES-02: the ledger is fetched newest-first in a fixed page.
  // When the page is full the totals may under-count, so say so -- and show the
  // totals as "N+" rather than as exact figures.
  const capped = all.length >= INVENTORY_LEDGER_LIMIT;
  const totalQty = rows.reduce((s, e) => s + (kind === "receipt" ? e.qtyIn : e.qtyOut), 0);

  const qtyCol: Col =
    kind === "receipt"
      ? { key: "qtyIn", label: "Qty In", align: "right" }
      : { key: "qtyOut", label: "Qty Out", align: "right" };

  const columns: Col[] = [
    { key: "postingDate", label: "Date", render: (r) => formatIndianDate(r.postingDate) },
    // GAP-INVENTORY-ISSUES-03: item by SKU/name (short id only as a fallback),
    // plus store and reason. The Type column is gone: this table is filtered to
    // one movement type, so it repeated the same word on every row.
    { key: "itemId", label: "Item", render: (r) => <span title={r.itemId}>{itemLabel(r)}</span> },
    { key: "storeId", label: "Store", render: (r) => <span title={r.storeId}>{nameOrDash(r.storeName)}</span> },
    qtyCol,
    { key: "balanceQty", label: "Balance", align: "right" },
    { key: "rateMinor", label: "Rate", align: "right", render: (r) => formatMoney(r.rateMinor) },
    { key: "valueMinor", label: "Value", align: "right", render: (r) => formatMoney(r.valueMinor) },
    { key: "reasonCode", label: "Reason", render: (r) => r.reasonCode ?? "—" },
  ];

  const lineLabel = kind === "receipt" ? "Receipt Lines" : "Issue Lines";
  const qtyLabel = kind === "receipt" ? "Total Qty Received" : "Total Qty Issued";

  return (
    <div aria-label={kind === "receipt" ? "Inventory goods receipts" : "Inventory stock issues"}>
      <StatGrid>
        <StatCard
          icon={kind === "receipt" ? "📥" : "📤"}
          iconBg={kind === "receipt" ? "#dcfce7" : "#fee2e2"}
          label={lineLabel}
          value={statValue(provenance, capped ? `${rows.length}+` : rows.length)}
        />
        <StatCard icon="🔢" iconBg="#f1f5f9" label={qtyLabel} value={statValue(provenance, capped ? `${totalQty}+` : totalQty)} />
      </StatGrid>
      <Card title={kind === "receipt" ? "Receipts" : "Issues"}>
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="stock ledger" capNote={capNote(all.length, INVENTORY_LEDGER_LIMIT, "ledger movements")}>
          <DataTable<InventoryLedgerRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={`Filter ${kind}s…`}
            pageSize={15}
          />
        </RegisterFrame>
      </Card>
    </div>
  );
}
