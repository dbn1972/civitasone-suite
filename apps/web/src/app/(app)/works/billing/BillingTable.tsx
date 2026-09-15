"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "billNo", label: "Bill No", sortable: true },
  { key: "work", label: "Work", sortable: true },
  { key: "mode", label: "Mode", sortable: true },
  { key: "gross", label: "Gross", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "netPayable", label: "Net Payable", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "stage", label: "Stage", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

export function BillingTable({ bills, source }: { bills: Record<string, unknown>[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("works-billing", bills, source, (rows) => rows.length === 0);

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `data`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable
        columns={columns}
        rows={data}
        sortable
        filterable
        filterPlaceholder="Search bills..."
        pageSize={15}
        exportable
        exportFilename="works-billing"
        emptyIcon="💰"
        emptyTitle="No bills found"
        emptyMessage="Works billing records will appear here."
        rowHref={(row) => "/works/billing/" + String(row.workId ?? "")}
      />
    </>
  );
}
