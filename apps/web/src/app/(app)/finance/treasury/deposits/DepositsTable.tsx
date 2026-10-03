"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceDepositSummary } from "@civitasone/types";
import { depositStatusVariant, depositTypeLabel } from "./depositStats";

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
          { key: "pdNo", label: "Deposit No" },
          { key: "type", label: "Type" },
          { key: "administrator", label: "Administrator" },
          { key: "balanceMinor", label: "Balance", align: "right", cellType: "amount" },
          { key: "createdAt", label: "Opened", cellType: "date" },
          { key: "status", label: "Status", render: (row) => <StatusPill status={String(row.status)} variant={depositStatusVariant(row.status)} /> },
        ]}
        // Deposit type shown (and exported) as its name, not the raw pd/emd/sd/fdr code.
        rows={rows.map((r) => ({ ...r, type: depositTypeLabel(r.type) }))}
        rowLinkKey="id"
        rowLinkPrefix="/finance/treasury/deposits/"
        sortable
        filterable
        filterPlaceholder="Search deposits…"
        pageSize={15}
        exportable
        exportFilename="deposits-register"
        emptyIcon="🏧"
        emptyTitle="No deposits"
        emptyMessage="No deposits found."
      />
    </>
  );
}
