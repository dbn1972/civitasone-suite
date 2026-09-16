"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { CashBookEntry } from "@civitasone/types";

type Entry = CashBookEntry;

export function CashBankTable({ entries, source = "api" }: { entries: Entry[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Entry[]>(
    "finance.cashbook",
    entries,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
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
