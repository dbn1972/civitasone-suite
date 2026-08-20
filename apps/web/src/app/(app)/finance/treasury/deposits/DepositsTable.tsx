"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceDepositSummary } from "@civitasone/types";

type Deposit = FinanceDepositSummary;

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
          { key: "pdNo", label: "PD No" },
          { key: "type", label: "Type" },
          { key: "administrator", label: "Administrator" },
          { key: "balanceMinor", label: "Balance", align: "right", cellType: "amount" },
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
