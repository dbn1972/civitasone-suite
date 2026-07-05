"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Entry = Record<string, unknown>;

export function CashBankTable({ entries, source = "api" }: { entries: Entry[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Entry[]>(
    "finance.cashbook",
    entries,
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
      <DataTable<Entry>
        columns={[
          { key: "date", label: "Date" },
          { key: "particulars", label: "Particulars" },
          { key: "voucherNo", label: "Voucher No" },
          { key: "receipt", label: "Receipt", align: "right" },
          { key: "payment", label: "Payment", align: "right" },
          { key: "balance", label: "Balance", align: "right" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search entries…"
        pageSize={20}
        exportable
        exportFilename="cash-bank-book"
        emptyIcon="📖"
        emptyTitle="No entries"
        emptyMessage="No cash & bank book entries found for this period."
      />
    </>
  );
}
