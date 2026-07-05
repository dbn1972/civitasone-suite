"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function DebtTable({ loans, source = "api" }: { loans: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.debt", loans, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "loanId", label: "Loan ID" },
          { key: "lender", label: "Lender" },
          { key: "principal", label: "Principal", align: "right" },
          { key: "outstanding", label: "Outstanding", align: "right" },
          { key: "interestRate", label: "Rate (%)", align: "right" },
          { key: "nextEmi", label: "Next EMI" },
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
