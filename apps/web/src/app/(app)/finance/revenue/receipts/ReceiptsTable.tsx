"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function ReceiptsTable({ receipts, source = "api" }: { receipts: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.receipts", receipts, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row> columns={[{ key: "receiptNo", label: "Receipt No" },{ key: "payer", label: "Payer" },{ key: "head", label: "Budget Head" },{ key: "amount", label: "Amount", align: "right" },{ key: "mode", label: "Mode" },{ key: "date", label: "Date" }]} rows={rows} sortable filterable filterPlaceholder="Search receipts…" pageSize={15} exportable exportFilename="receipt-vouchers" emptyIcon="📥" emptyTitle="No receipts" emptyMessage="No receipt vouchers found." />
    </>
  );
}
