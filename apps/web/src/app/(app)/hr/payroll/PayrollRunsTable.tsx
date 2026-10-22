"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import type { PayrollRunDetail } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney } from "@/lib/formatters";
import { payrollRunStatusLabel, payrollRunStatusVariant } from "@/lib/payroll/statusLabels";

type PayrollRunsTableProps = { runs: PayrollRunDetail[]; source?: "api" | "error"; canAdminister?: boolean };

/**
 * GAP-PAYROLL-HOME-06: useSeededResource keeps the rows in useState seeded
 * from `runs` ONCE (its sync effect only re-runs on cacheKey/serverSource, not
 * when the `runs` prop is replaced), so after CreatePayrollRunForm's
 * router.refresh() -- the pay-group "created N runs" branch and the no-id
 * fallback, both of which stay on this page -- the server re-rendered with the
 * new run but this table kept showing the old rows. Keying the body on the
 * data itself remounts it (re-seeding from the fresh props, and re-writing the
 * offline copy) whenever the server hands over a different run list, without
 * touching the shared hook that many other screens share. Same data in,
 * same key: ordinary parent re-renders do not remount.
 */
export function PayrollRunsTable(props: PayrollRunsTableProps) {
  const seedKey = props.runs
    .map((r) => [r.id, r.payPeriod, r.status, r.employeeCount, r.grossAmount, r.netAmount].join(":"))
    .join("|");
  return <PayrollRunsTableBody key={seedKey} {...props} />;
}

function PayrollRunsTableBody({ runs, source = "api", canAdminister = false }: PayrollRunsTableProps) {
  const t = useTranslations("payrollRunsTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<PayrollRunDetail[]>(
    "hr.payroll.runs",
    runs,
    source,
    (d) => d.length === 0,
  );

  // GAP-PAYROLL-HOME-01: money comes from the API's integer-paise strings
  // (grossMinor / netMinor), rendered with formatMoney at the display edge.
  // The legacy rupee floats (grossAmount / netAmount) are no longer read here.
  const columns: { key: keyof PayrollRunDetail & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount"; render?: (row: PayrollRunDetail) => ReactNode }[] = [
    { key: "payPeriod", label: t("colPeriod") },
    { key: "employeeCount", label: t("colEmployees"), align: "right" },
    { key: "grossMinor", label: t("colGross"), align: "right", render: (r) => formatMoney(r.grossMinor) },
    { key: "netMinor", label: t("colNet"), align: "right", render: (r) => formatMoney(r.netMinor) },
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
