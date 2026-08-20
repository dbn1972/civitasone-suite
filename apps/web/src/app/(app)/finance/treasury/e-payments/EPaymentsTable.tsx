"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { PaymentSummary } from "@civitasone/types";

// DataTable's generic requires an index signature; PaymentSummary is a plain
// named interface. The intersection satisfies the constraint without
// widening away real field names/types (unlike `as unknown as Record<...>`).
type Row = PaymentSummary & Record<string, unknown>;

export function EPaymentsTable({ orders, source = "api" }: { orders: PaymentSummary[]; source?: "api" | "error" }) {
  // Single narrow cast: Row has identical field names/types to PaymentSummary,
  // plus a compile-time-only index signature DataTable's generic requires.
  // Not `as unknown as` — no type information is erased, every named field
  // stays exactly as typed.
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>(
    "finance.epayment.orders",
    orders as Row[],
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      {/* Columns match PaymentSummary's real shape (referenceId/beneficiary/amountDisplay/status) —
          no bank/bankRef/date fields exist on this endpoint's response. */}
      <DataTable<Row>
        columns={[
          { key: "referenceId", label: "Reference" },
          { key: "beneficiary", label: "Beneficiary" },
          { key: "amountDisplay", label: "Amount", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search payment orders…"
        pageSize={15}
        exportable
        exportFilename="e-payment-orders"
        emptyIcon="💳"
        emptyTitle="No payment orders"
        emptyMessage="No electronic payment orders found."
      />
    </>
  );
}
