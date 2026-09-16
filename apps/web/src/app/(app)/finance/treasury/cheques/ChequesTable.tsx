"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceInstrumentSummary } from "@civitasone/types";

type Cheque = FinanceInstrumentSummary;

export function ChequesTable({ cheques, source = "api" }: { cheques: Cheque[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Cheque[]>(
    "finance.cheques",
    cheques,
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
      <DataTable<Cheque>
        columns={[
          { key: "instrumentNo", label: "Cheque/DD No" },
          { key: "payee", label: "Payee" },
          { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
          { key: "bankName", label: "Drawn On" },
          { key: "issueDate", label: "Issued" },
          { key: "clearedAt", label: "Cleared" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/treasury/cheques/"
        sortable
        filterable
        filterPlaceholder="Search cheques…"
        pageSize={15}
        exportable
        exportFilename="cheque-register"
        emptyIcon="📝"
        emptyTitle="No cheques"
        emptyMessage="No cheques or demand drafts found."
      />
    </>
  );
}
