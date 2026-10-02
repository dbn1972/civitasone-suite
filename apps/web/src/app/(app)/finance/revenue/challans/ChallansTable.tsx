"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatReceiptHead } from "@/lib/finance/challanRegister";
import type { FinanceChallanSummary } from "@civitasone/types";
// receiptHead is the display text ("0040 - Tax Revenue"); a real column key so the
// search box and CSV export use the same text the clerk sees (GAP-...-CHALLANS-02).
type Row = FinanceChallanSummary & { receiptHead: string };
export function ChallansTable({ challans, source = "api" }: { challans: FinanceChallanSummary[]; source?: "api" | "error" }) {
  const { data: fetched, provenance, offline, cachedAt } = useSeededResource<FinanceChallanSummary[]>("finance.challans", challans, source, (d) => d.length === 0);
  const rows: Row[] = fetched.map((c) => ({ ...c, receiptHead: formatReceiptHead(c.receiptHeadCode, c.receiptHeadName) }));
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row> columns={[{ key: "challanNo", label: "Challan No" },{ key: "depositor", label: "Depositor" },{ key: "receiptHead", label: "Receipt Head" },{ key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },{ key: "createdAt", label: "Date", cellType: "date" },{ key: "status", label: "Status", cellType: "status" }]} rows={rows} rowLinkKey="id" rowLinkPrefix="/finance/revenue/challans/" sortable filterable filterPlaceholder="Search challans…" pageSize={15} exportable exportFilename="challan-register" emptyIcon="📄" emptyTitle="No challans" emptyMessage="No government challans found." />
    </>
  );
}
