"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { sideAmountOrNull } from "@/lib/finance/cashBook";
import type { CashBookEntry } from "@civitasone/types";

type Entry = CashBookEntry;
// Receipt/Payment are null on the empty side of a row so the cell shows a dash, not ₹0.00.
type Row = Omit<Entry, "receipt_minor" | "payment_minor"> & { receipt_minor: string | null; payment_minor: string | null };

export function CashBankTable({
  entries,
  source = "api",
  cacheKey = "finance.cashbook",
  period = "cash & bank book entries",
}: {
  entries: Entry[];
  source?: "api" | "error";
  /** Per-filter cache key so one account/range never shows another's cached rows. */
  cacheKey?: string;
  /** Names the selected account + date range in the empty state. */
  period?: string;
}) {
  const { data: fetched, provenance, offline, cachedAt } = useSeededResource<Entry[]>(
    cacheKey,
    entries,
    source,
    (d) => d.length === 0,
  );

  const rows: Row[] = fetched.map((e) => ({
    ...e,
    receipt_minor: sideAmountOrNull(e.receipt_minor),
    payment_minor: sideAmountOrNull(e.payment_minor),
  }));

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "entry_date", label: "Date", cellType: "date" },
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
        emptyMessage={`No ${period} found.`}
      />
    </>
  );
}
