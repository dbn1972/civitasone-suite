"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceChallanSummary } from "@civitasone/types";
type Row = FinanceChallanSummary;
export function ChallansTable({ challans, source = "api" }: { challans: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.challans", challans, source, (d) => d.length === 0);
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row> columns={[{ key: "challanNo", label: "Challan No" },{ key: "depositor", label: "Depositor" },{ key: "receiptHeadId", label: "Receipt Head" },{ key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },{ key: "createdAt", label: "Date" },{ key: "status", label: "Status", cellType: "status" }]} rows={rows} rowLinkKey="id" rowLinkPrefix="/finance/revenue/challans/" sortable filterable filterPlaceholder="Search challans…" pageSize={15} exportable exportFilename="challan-register" emptyIcon="📄" emptyTitle="No challans" emptyMessage="No government challans found." />
    </>
  );
}
