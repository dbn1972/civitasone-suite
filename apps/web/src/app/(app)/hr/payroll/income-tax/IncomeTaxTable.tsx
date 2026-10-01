"use client";

import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../../_components/ds";
import { incomeTaxStatusLabel } from "@/lib/payroll/statusLabels";
import { formatRupees } from "@/lib/formatters";

type Row = {
  id: string;
  employee: string;
  department: string;
  grossIncome: string;
  deductions80C: string;
  otherDeductions: string;
  taxableIncome: string;
  taxPayable: string;
  status: string;
  /** GAP-PAYROLL-INCOME-TAX-05: "old" | "new" (API default "new"). */
  regime?: string;
} & Record<string, unknown>;

/**
 * Under the new regime payroll-service does not apply 80C/other Chapter VI-A
 * deductions at all (tax/routes.ts always returns 0 for them), so a ₹0 there
 * means "not applicable", not "nothing declared".
 */
function deductionCell(r: Row, value: string): string {
  return r.regime === "new" ? "—" : formatRupees(value);
}

/**
 * GAP-PAYROLL-INCOME-TAX-03/04: a "use client" wrapper around DataTable --
 * page.tsx is a Server Component and a `render` column (needed for the
 * translated StatusPill label below) cannot cross that boundary, the same
 * constraint SalarySlipsTable.tsx's own doc comment documents. Also adds the
 * Department column (GAP-03): the API already returns `department` (used
 * today only for the "Departments" stat tile), it just had no table column.
 */
export function IncomeTaxTable({ items }: { items: Row[] }) {
  const t = useTranslations("incomeTax");

  const columns: {
    key: keyof Row & string;
    label: string;
    align?: "left" | "right";
    cellType?: "rupees";
    render?: (row: Row) => React.ReactNode;
  }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    {
      key: "regime",
      label: t("colRegime"),
      render: (r) => (r.regime === "old" ? t("regimeOld") : r.regime === "new" ? t("regimeNew") : "—"),
    },
    { key: "grossIncome", label: t("colGrossIncome"), cellType: "rupees", align: "right" },
    { key: "deductions80C", label: t("col80c"), align: "right", render: (r) => deductionCell(r, r.deductions80C) }, // gitleaks:allow -- column key, not a secret
    { key: "otherDeductions", label: t("colOtherDed"), align: "right", render: (r) => deductionCell(r, r.otherDeductions) }, // gitleaks:allow -- column key, not a secret
    { key: "taxableIncome", label: t("colTaxableIncome"), cellType: "rupees", align: "right" },
    { key: "taxPayable", label: t("colTaxPayable"), cellType: "rupees", align: "right" },
    {
      key: "status",
      label: t("colStatus"),
      render: (r) => <StatusPill status={r.status} label={incomeTaxStatusLabel(r.status, t)} />,
    },
  ];

  return (
    <DataTable<Row>
      columns={columns}
      rows={items}
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
