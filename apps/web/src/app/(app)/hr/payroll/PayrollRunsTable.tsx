"use client";

import type { ReactNode } from "react";
import { DataTable } from "../../../_components/ds";
import type { PayrollRunDetail } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { formatRupees } from "@/lib/formatters";

// grossAmount/netAmount come from the payroll-runs API already in RUPEES (not paise),
// so they must NOT use cellType:"amount" (which runs formatMoney and divides by 100).
const columns: { key: keyof PayrollRunDetail & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount"; render?: (row: PayrollRunDetail) => ReactNode }[] = [
  { key: "payPeriod", label: "Period" },
  { key: "employeeCount", label: "Employees", align: "right" },
  { key: "grossAmount", label: "Gross Pay", align: "right", render: (r) => formatRupees(r.grossAmount) },
  { key: "netAmount", label: "Net Pay", align: "right", render: (r) => formatRupees(r.netAmount) },
  { key: "status", label: "Status", cellType: "status" },
];

export function PayrollRunsTable({ runs, source = "api" }: { runs: PayrollRunDetail[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<PayrollRunDetail[]>(
    "hr.payroll.runs",
    runs,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<PayrollRunDetail>
        columns={columns}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/hr/payroll/"
        sortable
        filterable
        filterPlaceholder="Filter by period or status…"
        pageSize={12}
      />
    </>
  );
}
