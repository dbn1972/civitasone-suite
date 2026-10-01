"use client";

import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../../_components/ds";
import { incomeTaxStatusLabel } from "@/lib/payroll/statusLabels";

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
} & Record<string, unknown>;

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
    { key: "grossIncome", label: t("colGrossIncome"), cellType: "rupees", align: "right" },
    { key: "deductions80C", label: t("col80c"), cellType: "rupees", align: "right" },
    { key: "otherDeductions", label: t("colOtherDed"), cellType: "rupees", align: "right" },
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
