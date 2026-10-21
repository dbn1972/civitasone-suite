"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import type { PayrollRunDetail } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { formatRunMoney } from "@/lib/payroll/runMoney";
import { payrollRunStatusLabel, payrollRunStatusVariant } from "@/lib/payroll/statusLabels";

export function PayrollRunsTable({ runs, source = "api", canAdminister = false }: { runs: PayrollRunDetail[]; source?: "api" | "error"; canAdminister?: boolean }) {
  const t = useTranslations("payrollRunsTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<PayrollRunDetail[]>(
    "hr.payroll.runs",
    runs,
    source,
    (d) => d.length === 0,
  );

  // GAP-PAYROLL-RUNS-01: gross/net render through the shared run-money adapter
  // (lib/payroll/runMoney.ts), which prefers the API's exact integer-paise
  // grossMinor/netMinor strings and only falls back to the legacy rupee floats
  // (grossAmount/netAmount) for an older payroll-service. They use `render`, not
  // cellType:"amount", because the sort key stays the numeric rupee field.
  const columns: { key: keyof PayrollRunDetail & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount"; render?: (row: PayrollRunDetail) => ReactNode }[] = [
    { key: "payPeriod", label: t("colPeriod") },
    { key: "employeeCount", label: t("colEmployees"), align: "right" },
    { key: "grossAmount", label: t("colGross"), align: "right", render: (r) => formatRunMoney(r, "gross") },
    { key: "netAmount", label: t("colNet"), align: "right", render: (r) => formatRunMoney(r, "net") },
    // Hindi-locale finding: cellType:"status" rendered the raw backend enum
    // (draft/processing/completed/paid/disbursed/failed) verbatim -- no
    // i18n. `render` (checked before cellType by DataTable's cellValue())
    // keeps the pill's color keyed off the real `status` while giving it a
    // translated `label` explicitly, via this table's own i18n status map.
    { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={r.status} label={payrollRunStatusLabel(r.status, t)} variant={payrollRunStatusVariant(r.status)} /> },
  ];

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
        message={provenance === "error-no-data" ? t("loadErrorMessage") : undefined}
      />
      <DataTable<PayrollRunDetail>
        columns={columns}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/hr/payroll/"
        caption={t("tableCaption")}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={12}
        emptyIcon="💰"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
        emptyAction={
          canAdminister ? (
            <p style={{ marginTop: 10, fontSize: 13, color: "var(--ink2)" }}>
              {t("emptyActionHint")}
            </p>
          ) : undefined
        }
      />
    </>
  );
}
