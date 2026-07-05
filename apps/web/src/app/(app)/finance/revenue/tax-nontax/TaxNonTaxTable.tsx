"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function TaxNonTaxTable({ heads, source = "api" }: { heads: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.tax-nontax", heads, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row> columns={[{ key: "headCode", label: "Head Code" },{ key: "description", label: "Description" },{ key: "category", label: "Category" },{ key: "budgetEstimate", label: "BE", align: "right" },{ key: "actual", label: "Actual", align: "right" },{ key: "variance", label: "Variance", align: "right" }]} rows={rows} sortable filterable filterPlaceholder="Search revenue heads…" pageSize={15} exportable exportFilename="tax-nontax-revenue" emptyIcon="📊" emptyTitle="No revenue data" emptyMessage="No tax/non-tax revenue heads found." />
    </>
  );
}
