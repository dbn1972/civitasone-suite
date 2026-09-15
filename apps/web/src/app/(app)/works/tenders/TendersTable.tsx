"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "work", label: "Work", sortable: true },
  { key: "tenderType", label: "Tender Type", sortable: true },
  { key: "amount", label: "Amount", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "openingDate", label: "Opening Date", sortable: true },
  { key: "authority", label: "Authority", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

export function TendersTable({ tenders, source }: { tenders: Record<string, unknown>[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("works-tenders", tenders, source, (rows) => rows.length === 0);

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
        filterPlaceholder="Search tenders..."
        pageSize={15}
        exportable
        exportFilename="works-tenders"
        emptyIcon="📢"
        emptyTitle="No tenders found"
        emptyMessage="Tender records will appear here once created."
        rowHref={(row) => "/works/tenders/" + String(row.id ?? "")}
      />
    </>
  );
}
