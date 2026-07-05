"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function UserChargesTable({ charges, source = "api" }: { charges: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.user-charges", charges, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "service", label: "Service" },
          { key: "chargeType", label: "Charge Type" },
          { key: "applicant", label: "Applicant" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "date", label: "Date" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search charges…"
        pageSize={15}
        exportable
        exportFilename="user-charges"
        emptyIcon="🎫"
        emptyTitle="No charges"
        emptyMessage="No user charge records found."
      />
    </>
  );
}
