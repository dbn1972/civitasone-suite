"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function GuaranteesTable({ guarantees, source = "api" }: { guarantees: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.guarantees", guarantees, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "guaranteeNo", label: "BG No" },
          { key: "type", label: "Type" },
          { key: "vendor", label: "Vendor" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "bank", label: "Issuing Bank" },
          { key: "expiryDate", label: "Expiry" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search guarantees…"
        pageSize={15}
        exportable
        exportFilename="guarantees-emd"
        emptyIcon="🛡️"
        emptyTitle="No guarantees"
        emptyMessage="No bank guarantees or EMDs found."
      />
    </>
  );
}
