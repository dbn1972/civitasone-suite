"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceSchemeSummary } from "@civitasone/types";
type Row = FinanceSchemeSummary;
export function SchemeTable({ schemes, source = "api" }: { schemes: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.schemes", schemes, source, (d) => d.length === 0);
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
          { key: "code", label: "Code" },
          { key: "name", label: "Scheme" },
          { key: "funding", label: "Funding" },
          { key: "outlayMinor", label: "Outlay", align: "right", cellType: "amount" },
          { key: "utilisedMinor", label: "Utilised", align: "right", cellType: "amount" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/expenditure/scheme-tracking/"
        identifyingColumnKey="name"
        sortable
        filterable
        filterPlaceholder="Search schemes…"
        pageSize={15}
        exportable
        exportFilename="scheme-tracking"
        emptyIcon="🎯"
        emptyTitle="No schemes"
        emptyMessage="No scheme expenditure records found."
      />
    </>
  );
}
