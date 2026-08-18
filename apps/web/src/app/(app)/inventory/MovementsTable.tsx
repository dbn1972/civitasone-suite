"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { InventoryLedgerRow } from "./_data";

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
  const { data: all, fromCache, offline, cachedAt } = useSeededResource<InventoryLedgerRow[]>(
    `inventory.ledger.${kind}`,
    entries,
    source,
    (d) => d.length === 0,
  );

  const rows = all.filter((r) => r.movementType === kind);

  const qtyCol: Col =
    kind === "receipt"
      ? { key: "qtyIn", label: "Qty In", align: "right" }
      : { key: "qtyOut", label: "Qty Out", align: "right" };

  const columns: Col[] = [
    { key: "postingDate", label: "Date", render: (r) => formatIndianDate(r.postingDate) },
    { key: "itemId", label: "Item", render: (r) => <code>{r.itemId.slice(0, 8)}</code> },
    qtyCol,
    { key: "balanceQty", label: "Balance", align: "right" },
    { key: "rateMinor", label: "Rate", align: "right", render: (r) => formatMoney(r.rateMinor) },
    { key: "valueMinor", label: "Value", align: "right", render: (r) => formatMoney(r.valueMinor) },
    {
      key: "movementType",
      label: "Type",
      render: (r) => (
        <span role="status" aria-label={`Movement type: ${r.movementType}`}>
          <StatusPill status={r.movementType === "receipt" ? "completed" : "open"} label={r.movementType} />
        </span>
      ),
    },
  ];

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
      <DataTable<InventoryLedgerRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder={`Filter ${kind}s…`}
        pageSize={15}
      />
    </>
  );
}
