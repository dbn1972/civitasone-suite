"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { VendorTdsEntry } from "@civitasone/types";
type Row = VendorTdsEntry;
export function TDSReturnsTable({ returns, source = "api" }: { returns: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.tds-returns", returns, source, (d) => d.length === 0);
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
          { key: "vendor_name", label: "Vendor" },
          { key: "section", label: "Section" },
          { key: "quarter", label: "Quarter" },
          { key: "fy", label: "FY" },
          { key: "tds_amount_minor", label: "Total TDS", align: "right", cellType: "amount" },
          { key: "deduction_date", label: "Deduction Date" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search TDS returns…"
        pageSize={15}
        exportable
        exportFilename="tds-returns"
        emptyIcon="📑"
        emptyTitle="No TDS returns"
        emptyMessage="No TDS return records found."
      />
    </>
  );
}
