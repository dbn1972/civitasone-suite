"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceVendorSummary } from "@civitasone/types";

// DataTable's generic requires an index signature; FinanceVendorSummary is a
// plain named type. Intersection satisfies the constraint without widening
// away real field names/types.
type Row = FinanceVendorSummary & Record<string, unknown>;

export function VendorsTable({ vendors, source = "api" }: { vendors: FinanceVendorSummary[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.vendors", vendors as Row[], source, (d) => d.length === 0);
  return (
    <>
      {/* UX-002: single source of truth — reads the same useSeededResource
          call as `rows`, so it can never contradict this table. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "name", label: "Vendor Name" },
          { key: "pan", label: "PAN" },
          { key: "gstin", label: "GSTIN" },
          { key: "category", label: "Category" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/vendors/"
        sortable
        filterable
        filterPlaceholder="Search vendors…"
        pageSize={15}
        exportable
        exportFilename="vendor-master"
        emptyIcon="🏢"
        emptyTitle="No vendors"
        emptyMessage="No vendors registered yet."
      />
    </>
  );
}
