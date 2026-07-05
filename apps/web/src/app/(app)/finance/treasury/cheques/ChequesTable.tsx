"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Cheque = Record<string, unknown>;

export function ChequesTable({ cheques, source = "api" }: { cheques: Cheque[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Cheque[]>(
    "finance.cheques",
    cheques,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Cheque>
        columns={[
          { key: "chequeNo", label: "Cheque/DD No" },
          { key: "payee", label: "Payee" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "bank", label: "Drawn On" },
          { key: "issuedDate", label: "Issued" },
          { key: "clearanceDate", label: "Cleared" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/treasury/cheques/"
        sortable
        filterable
        filterPlaceholder="Search cheques…"
        pageSize={15}
        exportable
        exportFilename="cheque-register"
        emptyIcon="📝"
        emptyTitle="No cheques"
        emptyMessage="No cheques or demand drafts found."
      />
    </>
  );
}
