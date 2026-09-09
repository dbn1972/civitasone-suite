"use client";

import type { ReactNode } from "react";
import { DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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

export function PayrollRunsTable({ runs, source = "api", canAdminister = false }: { runs: PayrollRunDetail[]; source?: "api" | "error"; canAdminister?: boolean }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<PayrollRunDetail[]>(
    "hr.payroll.runs",
    runs,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-002: this badge is the ONLY place that reports data provenance for
          the payroll runs shown below — it reads the same useSeededResource
          call as `rows`, so it can never disagree with what the table shows.
          (hr/payroll/page.tsx used to render a second, independent badge from
          the raw server `source` — removed, since it could contradict this one.) */}
      <DataSourceBadge
        provenance={provenance ?? "live"}
        cachedAt={cachedAt}
        offline={offline}
        message={provenance === "error-no-data" ? "Couldn't load payroll runs — showing nothing" : undefined}
      />
      <DataTable<PayrollRunDetail>
        columns={columns}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/hr/payroll/"
        sortable
        filterable
        filterPlaceholder="Filter by period or status…"
        pageSize={12}
        emptyIcon="💰"
        emptyTitle="No payroll runs yet"
        emptyMessage="Payroll runs process and disburse monthly salaries. Create your first run to get started."
        emptyAction={
          canAdminister ? (
            <p style={{ marginTop: 10, fontSize: 13, color: "var(--ink2)" }}>
              Use the &quot;New Payroll Run&quot; form above to create your first run.
            </p>
          ) : undefined
        }
      />
    </>
  );
}
