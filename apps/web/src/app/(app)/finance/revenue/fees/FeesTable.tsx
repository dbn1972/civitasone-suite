"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function FeesTable({ fees, source = "api" }: { fees: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.fees", fees, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row> columns={[{ key: "feeType", label: "Fee Type" },{ key: "category", label: "Category" },{ key: "applicant", label: "Applicant" },{ key: "amount", label: "Amount", align: "right" },{ key: "date", label: "Date" },{ key: "status", label: "Status", cellType: "status" }]} rows={rows} sortable filterable filterPlaceholder="Search fees…" pageSize={15} exportable exportFilename="fees-collection" emptyIcon="🎫" emptyTitle="No fees" emptyMessage="No fee collection records found." />
    </>
  );
}
