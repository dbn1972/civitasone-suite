"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceDepositSummary } from "@civitasone/types";

type Deposit = FinanceDepositSummary;

export function DepositsTable({ deposits, source = "api" }: { deposits: Deposit[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Deposit[]>(
    "finance.deposits",
    deposits,
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
      <DataTable<Deposit>
        columns={[
          { key: "pdNo", label: "PD No" },
          { key: "type", label: "Type" },
          { key: "administrator", label: "Administrator" },
          { key: "balanceMinor", label: "Balance", align: "right", cellType: "amount" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search deposits…"
        pageSize={15}
        exportable
        exportFilename="fixed-deposits"
        emptyIcon="🏧"
        emptyTitle="No deposits"
        emptyMessage="No fixed or term deposits found."
      />
    </>
  );
}
