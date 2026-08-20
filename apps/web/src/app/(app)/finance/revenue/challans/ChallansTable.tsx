"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceChallanSummary } from "@civitasone/types";
type Row = FinanceChallanSummary;
export function ChallansTable({ challans, source = "api" }: { challans: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.challans", challans, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row> columns={[{ key: "challanNo", label: "Challan No" },{ key: "depositor", label: "Depositor" },{ key: "receiptHeadId", label: "Receipt Head" },{ key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },{ key: "createdAt", label: "Date" },{ key: "status", label: "Status", cellType: "status" }]} rows={rows} rowLinkKey="id" rowLinkPrefix="/finance/revenue/challans/" sortable filterable filterPlaceholder="Search challans…" pageSize={15} exportable exportFilename="challan-register" emptyIcon="📄" emptyTitle="No challans" emptyMessage="No government challans found." />
    </>
  );
}
