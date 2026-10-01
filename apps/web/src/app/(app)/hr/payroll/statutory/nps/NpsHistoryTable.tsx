"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "../../../../../_components/ds";

type NpsRow = {
  id: string;
  employeeId: string;
  employeeName: string | null;
  period: string;
  basicMinor: number;
  empContribPct: number;
  erContribPct: number;
  empContribMinor: number;
  erContribMinor: number;
} & Record<string, unknown>;

/**
 * GAP-PAYROLL-STATUTORY-NPS-05/06: a "use client" wrapper around DataTable --
 * page.tsx is a Server Component, and both fixes below need a `render`
 * column, which (per DataTable's own doc comment and
 * scripts/ci/datatable-render-guard.mjs) cannot cross the server/client
 * boundary. Two independent, backend-verified fixes:
 *
 *  - NPS-05's "raw employeeId" claim: payroll-service's statutory/queries.ts
 *    listNpsReport() already does a best-effort employeeName enrichment
 *    (`empMap.get(r.employeeId)?.fullName ?? null`, its own UX-021 comment)
 *    -- the data was already there, this page's Row type just never
 *    declared or used it.
 *  - NPS-06's bare rate numbers: appends "%" locally via `render` instead of
 *    adding a new DataTable-wide "percent" cellType, which is GAP-PAYROLL-
 *    STATUTORY-GPF-04's job (a sibling gap in a different fixer's cluster,
 *    not yet built as of this change) -- this avoids both duplicating that
 *    future shared cellType and taking a dependency on it landing first.
 */
export function NpsHistoryTable({ rows }: { rows: NpsRow[] }) {
  const t = useTranslations("nps");

  const columns: {
    key: keyof NpsRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount";
    render?: (row: NpsRow) => React.ReactNode;
  }[] = [
    { key: "employeeId", label: t("colEmployee"), render: (r) => <>{r.employeeName ?? r.employeeId}</> },
    { key: "period", label: t("colPeriod") },
    // GAP-PAYROLL-STATUTORY-NPS-05: relabeled from "Basic Pay" -- central-
    // government NPS contributions are computed on Basic + DA, but this
    // endpoint's row (statutory/schema.ts's payrollNps) only carries
    // basicMinor, no daMinor/contribution-base field, so asserting "Basic +
    // DA" here would be an unverified claim about what's actually in this
    // number. "Contribution Base" is accurate regardless of composition.
    { key: "basicMinor", label: t("colContributionBase"), align: "right", cellType: "amount" },
    { key: "empContribPct", label: t("colEmployeeRatePercent"), align: "right", render: (r) => <>{r.empContribPct}%</> },
    { key: "erContribPct", label: t("colEmployerRatePercent"), align: "right", render: (r) => <>{r.erContribPct}%</> },
    { key: "empContribMinor", label: t("colEmployeeNps"), align: "right", cellType: "amount" },
    { key: "erContribMinor", label: t("colEmployerNps"), align: "right", cellType: "amount" },
  ];

  return (
    <DataTable<NpsRow>
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      pageSize={15}
      emptyIcon="📊"
      emptyTitle={t("emptyTitle")}
      emptyMessage={t("emptyMessage")}
    />
  );
}
