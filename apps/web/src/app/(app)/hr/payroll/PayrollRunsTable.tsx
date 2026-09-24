"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import type { PayrollRunDetail } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { formatRupees } from "@/lib/formatters";

export function PayrollRunsTable({ runs, source = "api", canAdminister = false }: { runs: PayrollRunDetail[]; source?: "api" | "error"; canAdminister?: boolean }) {
  const t = useTranslations("payrollRunsTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<PayrollRunDetail[]>(
    "hr.payroll.runs",
    runs,
    source,
    (d) => d.length === 0,
  );

  // grossAmount/netAmount come from the payroll-runs API already in RUPEES (not paise),
  // so they must NOT use cellType:"amount" (which runs formatMoney and divides by 100).
  const columns: { key: keyof PayrollRunDetail & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount"; render?: (row: PayrollRunDetail) => ReactNode }[] = [
    { key: "payPeriod", label: t("colPeriod") },
    { key: "employeeCount", label: t("colEmployees"), align: "right" },
    { key: "grossAmount", label: t("colGross"), align: "right", render: (r) => formatRupees(r.grossAmount) },
    { key: "netAmount", label: t("colNet"), align: "right", render: (r) => formatRupees(r.netAmount) },
    { key: "status", label: t("colStatus"), cellType: "status" },
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
