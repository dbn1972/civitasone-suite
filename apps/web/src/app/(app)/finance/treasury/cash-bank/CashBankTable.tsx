"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { CashBookEntry } from "@civitasone/types";

type Entry = CashBookEntry;

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
          { key: "entry_date", label: "Date" },
          { key: "particulars", label: "Particulars" },
          { key: "voucher_no", label: "Voucher No" },
          { key: "receipt_minor", label: "Receipt", align: "right", cellType: "amount" },
          { key: "payment_minor", label: "Payment", align: "right", cellType: "amount" },
          { key: "balance_minor", label: "Balance", align: "right", cellType: "amount" },
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
