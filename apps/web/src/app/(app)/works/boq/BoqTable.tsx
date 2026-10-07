"use client";

import Link from "next/link";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  // GAP-WORKS-BOQ-01: Work is the first column so a reader can tell which work
  // each line belongs to (previously rows were only distinguishable by an
  // opaque 8-char scope UUID).
  { key: "work", label: "Work", sortable: true },
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
        // GAP-WORKS-BOQ-03: this screen has no work selector, so the old "once
        // a work is selected" copy was wrong. Point the user to the real next
        // step and give a CTA.
        emptyMessage="No BoQ items yet. Add an item to a work to get started."
        emptyAction={
          <Link href="/works/boq/new" className="btn primary">
            + Add BoQ item
          </Link>
        }
        rowHref={(row) => "/works/boq/" + String(row.workId ?? "")}
      />
    </>
  );
}
