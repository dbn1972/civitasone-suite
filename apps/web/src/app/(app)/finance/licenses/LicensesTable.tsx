"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function LicensesTable({ licenses, source = "api" }: { licenses: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.licenses", licenses, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "licenseNo", label: "License No" },
          { key: "type", label: "Type" },
          { key: "holder", label: "Holder" },
          { key: "issuedDate", label: "Issued" },
          { key: "expiryDate", label: "Expiry" },
          { key: "fee", label: "Fee", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/licenses/"
        sortable
        filterable
        filterPlaceholder="Search licenses…"
        pageSize={15}
        exportable
        exportFilename="licenses-permits"
        emptyIcon="📜"
        emptyTitle="No licenses"
        emptyMessage="No license or permit records found."
      />
    </>
  );
}
