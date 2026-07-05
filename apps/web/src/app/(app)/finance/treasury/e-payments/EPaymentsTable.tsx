"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Order = Record<string, unknown>;

export function EPaymentsTable({ orders, source = "api" }: { orders: Order[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Order[]>(
    "finance.epayment.orders",
    orders,
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
      <DataTable<Order>
        columns={[
          { key: "orderNo", label: "Order No" },
          { key: "beneficiary", label: "Beneficiary" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "bank", label: "Bank" },
          { key: "bankRef", label: "Bank Ref" },
          { key: "date", label: "Date" },
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
