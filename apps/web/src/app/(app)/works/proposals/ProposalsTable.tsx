"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "workNumber", label: "Work Number", sortable: true },
  { key: "description", label: "Description", sortable: true },
  { key: "category", label: "Category", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "estimatedCost", label: "Estimated Cost", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
  { key: "office", label: "Office", sortable: true },
];

export function ProposalsTable({ proposals, source }: { proposals: Record<string, unknown>[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("works-proposals", proposals, source, (rows) => rows.length === 0);

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
        filterPlaceholder="Search proposals..."
        pageSize={15}
        exportable
        exportFilename="work-proposals"
        emptyIcon="📋"
        emptyTitle="No proposals found"
        emptyMessage="Work proposals will appear here once created."
        rowHref={(row) => "/works/proposals/" + String(row.id ?? "")}
      />
    </>
  );
}
