"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { drawnOnLabel } from "@/lib/finance/chequeRegister";
import type { FinanceInstrumentSummary } from "@civitasone/types";

// drawnOn = bank name + masked last four digits; a real column key so search, sort and CSV use it.
type Cheque = FinanceInstrumentSummary & { drawnOn: string };

export function ChequesTable({ cheques, source = "api" }: { cheques: FinanceInstrumentSummary[]; source?: "api" | "error" }) {
  const { data: fetched, provenance, offline, cachedAt } = useSeededResource<FinanceInstrumentSummary[]>(
    "finance.cheques",
    cheques,
    source,
    (d) => d.length === 0,
  );

  const rows: Cheque[] = fetched.map((c) => ({ ...c, drawnOn: drawnOnLabel(c.bankName, c.accountNoLast4) }));

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
          { key: "drawnOn", label: "Drawn On" },
          { key: "issueDate", label: "Issued", cellType: "date" },
          { key: "clearedAt", label: "Cleared", cellType: "date" },
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
