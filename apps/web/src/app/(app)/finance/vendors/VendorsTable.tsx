"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { maskPan } from "@/app/_components/ds/Masked";
import { gstinCell } from "./vendorStats";
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
        // PAN is a DPDP identifier: mask it in the cell AND in the CSV export
        // (DataTable writes the row value), GAP-FINANCE-VENDORS-02.
        // GSTIN: a blank cell reads as missing data; say "Unregistered" (also in the CSV export).
        rows={rows.map((r) => ({ ...r, pan: r.pan ? maskPan(String(r.pan)) : r.pan, gstin: gstinCell(r.gstin as string | null | undefined) }))}
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
