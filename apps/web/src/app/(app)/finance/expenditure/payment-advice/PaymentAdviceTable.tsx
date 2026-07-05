"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function PaymentAdviceTable({ advices, source = "api" }: { advices: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.payment-advice", advices, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "adviceNo", label: "Advice No" },
          { key: "beneficiary", label: "Beneficiary" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "bank", label: "Bank" },
          { key: "issuedDate", label: "Issued" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search payment advice…"
        pageSize={15}
        exportable
        exportFilename="payment-advice"
        emptyIcon="📨"
        emptyTitle="No payment advice"
        emptyMessage="No payment advice notes found."
      />
    </>
  );
}
