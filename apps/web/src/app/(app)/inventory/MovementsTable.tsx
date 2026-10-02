"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import { RegisterFrame, statValue } from "./RegisterFrame";
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
  const { data: all, provenance, offline, cachedAt } = useSeededResource<InventoryLedgerRow[]>(
    `inventory.ledger.${kind}`,
    entries,
    source,
    (d) => d.length === 0,
  );

  const rows = all.filter((r) => r.movementType === kind);
  const totalQty = rows.reduce((s, e) => s + (kind === "receipt" ? e.qtyIn : e.qtyOut), 0);

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

  const lineLabel = kind === "receipt" ? "Receipt Lines" : "Issue Lines";
  const qtyLabel = kind === "receipt" ? "Total Qty Received" : "Total Qty Issued";

  return (
    <div aria-label={kind === "receipt" ? "Inventory goods receipts" : "Inventory stock issues"}>
      <StatGrid>
        <StatCard
          icon={kind === "receipt" ? "📥" : "📤"}
          iconBg={kind === "receipt" ? "#dcfce7" : "#fee2e2"}
          label={lineLabel}
          value={statValue(provenance, rows.length)}
        />
        <StatCard icon="🔢" iconBg="#f1f5f9" label={qtyLabel} value={statValue(provenance, totalQty)} />
      </StatGrid>
      <Card title={kind === "receipt" ? "Receipts" : "Issues"}>
        <RegisterFrame provenance={provenance} cachedAt={cachedAt} offline={offline} area="stock ledger">
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
