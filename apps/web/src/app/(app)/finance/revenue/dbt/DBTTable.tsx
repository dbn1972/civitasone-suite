"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function DBTTable({ beneficiaries, source = "api" }: { beneficiaries: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.dbt", beneficiaries, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row> columns={[{ key: "scheme", label: "Scheme" },{ key: "beneficiary", label: "Beneficiary" },{ key: "aadhaarMasked", label: "Aadhaar" },{ key: "amount", label: "Amount", align: "right" },{ key: "bankAccount", label: "Account" },{ key: "date", label: "Date" },{ key: "status", label: "Status", cellType: "status" }]} rows={rows} sortable filterable filterPlaceholder="Search beneficiaries…" pageSize={15} exportable exportFilename="dbt-beneficiaries" emptyIcon="🎯" emptyTitle="No DBT records" emptyMessage="No Direct Benefit Transfer records found." />
    </>
  );
}
