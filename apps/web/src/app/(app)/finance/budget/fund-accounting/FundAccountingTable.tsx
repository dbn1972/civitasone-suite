"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function FundAccountingTable({ funds, source = "api" }: { funds: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.fund-accounting", funds, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "fundName", label: "Fund" },
          { key: "source", label: "Source" },
          { key: "receipts", label: "Receipts", align: "right" },
          { key: "expenditure", label: "Expenditure", align: "right" },
          { key: "balance", label: "Balance", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search funds…"
        pageSize={15}
        exportable
        exportFilename="fund-accounting"
        emptyIcon="💰"
        emptyTitle="No funds"
        emptyMessage="No fund accounting records found."
      />
    </>
  );
}
