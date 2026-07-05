"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Deposit = Record<string, unknown>;

export function DepositsTable({ deposits, source = "api" }: { deposits: Deposit[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Deposit[]>(
    "finance.deposits",
    deposits,
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
      <DataTable<Deposit>
        columns={[
          { key: "depositId", label: "Deposit ID" },
          { key: "bank", label: "Bank" },
          { key: "principal", label: "Principal", align: "right" },
          { key: "interestRate", label: "Rate (%)", align: "right" },
          { key: "maturityDate", label: "Maturity" },
          { key: "tenure", label: "Tenure" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search deposits…"
        pageSize={15}
        exportable
        exportFilename="fixed-deposits"
        emptyIcon="🏧"
        emptyTitle="No deposits"
        emptyMessage="No fixed or term deposits found."
      />
    </>
  );
}
