"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "itemCode", label: "Item Code", sortable: true },
  { key: "description", label: "Description", sortable: true },
  { key: "unit", label: "Unit", sortable: true },
  { key: "rate", label: "Rate", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "quantity", label: "Quantity", align: "right" as const, sortable: true },
  { key: "amount", label: "Amount", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "scope", label: "Scope", sortable: true },
];

export function BoqTable({ items, source }: { items: Record<string, unknown>[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("works-boq", items, source, (rows) => rows.length === 0);

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
        filterPlaceholder="Search BoQ items..."
        pageSize={15}
        exportable
        exportFilename="works-boq"
        emptyIcon="📐"
        emptyTitle="No BoQ items found"
        emptyMessage="Bill of Quantities items will appear here once a work is selected."
        rowHref={(row) => "/works/boq/" + String(row.workId ?? "")}
      />
    </>
  );
}
