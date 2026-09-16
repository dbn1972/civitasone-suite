"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceDebtSummary } from "@civitasone/types";
type Row = FinanceDebtSummary;
export function DebtTable({ loans, source = "api" }: { loans: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.debt", loans, source, (d) => d.length === 0);
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
          { key: "instrument", label: "Instrument" },
          { key: "source", label: "Source" },
          { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
          { key: "maturity", label: "Maturity" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search loans…"
        pageSize={15}
        exportable
        exportFilename="debt-portfolio"
        emptyIcon="🏦"
        emptyTitle="No loans"
        emptyMessage="No loan or debt records found."
      />
    </>
  );
}
