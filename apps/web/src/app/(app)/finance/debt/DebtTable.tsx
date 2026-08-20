"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceDebtSummary } from "@civitasone/types";
type Row = FinanceDebtSummary;
export function DebtTable({ loans, source = "api" }: { loans: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.debt", loans, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "instrument", label: "Instrument" },
          { key: "source", label: "Source" },
          { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
          { key: "maturity", label: "Maturity" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search loans…"
        pageSize={15}
        exportable
        exportFilename="debt-portfolio"
        emptyIcon="🏦"
        emptyTitle="No loans"
        emptyMessage="No loan or debt records found."
      />
    </>
  );
}
