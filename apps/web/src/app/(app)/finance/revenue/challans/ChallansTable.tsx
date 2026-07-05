"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function ChallansTable({ challans, source = "api" }: { challans: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.challans", challans, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row> columns={[{ key: "challanNo", label: "Challan No" },{ key: "depositor", label: "Depositor" },{ key: "head", label: "Budget Head" },{ key: "amount", label: "Amount", align: "right" },{ key: "bank", label: "Bank" },{ key: "date", label: "Date" },{ key: "status", label: "Status", cellType: "status" }]} rows={rows} rowLinkKey="id" rowLinkPrefix="/finance/revenue/challans/" sortable filterable filterPlaceholder="Search challans…" pageSize={15} exportable exportFilename="challan-register" emptyIcon="📄" emptyTitle="No challans" emptyMessage="No government challans found." />
    </>
  );
}
