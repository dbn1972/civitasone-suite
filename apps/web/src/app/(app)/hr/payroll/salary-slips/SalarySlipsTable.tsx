"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState, StatusPill } from "../../../../_components/ds";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";
import type { SalarySlipSummary } from "@civitasone/types";
import { salarySlipStatusLabel } from "@/lib/payroll/statusLabels";

type Row = SalarySlipSummary & { printHref: string } & Record<string, unknown>;

export function SalarySlipsTable({ slips }: { slips: SalarySlipSummary[] }) {
  const t = useTranslations("salarySlipsTable");
  const columns: {
    key: keyof Row & string;
    label: string;
    align?: "left" | "right" | "center";
    cellType?: "status" | "amount";
    sortable?: boolean;
    render?: (row: Row) => React.ReactNode;
  }[] = [
    {
      key: "employeeName",
      label: t("colEmployee"),
      render: (r) => (
        <Link href={`/hr/employees/${r.employeeId}`} style={{ color: "var(--primary-d)", fontWeight: 600 }} tabIndex={-1}>
          {r.employeeName}
        </Link>
      ),
    },
    { key: "department", label: t("colDept") },
    { key: "payPeriod", label: t("colPayPeriod") },
    { key: "gross", label: t("colGross"), align: "right", cellType: "amount" },
    { key: "deductions", label: t("colDeductions"), align: "right", cellType: "amount" },
    { key: "net", label: t("colNet"), align: "right", cellType: "amount" },
    // Hindi-locale finding: cellType:"status" rendered the raw backend enum
    // (draft/finalized/paid/computed) verbatim -- no i18n. `render` (checked
    // before cellType by DataTable's cellValue()) keeps the pill's color
    // keyed off the real `status` while giving it a translated `label`
    // explicitly, via this table's own i18n status map.
    { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={r.status} label={salarySlipStatusLabel(r.status, t)} /> },
    {
      key: "printHref",
      label: t("colSlip"),
      align: "center",
      sortable: false,
      render: (r) => <PrintDocumentLink href={r.printHref} label={t("printLabel")} />,
    },
  ];

  const rows: Row[] = slips.map((s) => ({
    ...s,
    printHref: `/api/proxy/v1/payroll/slips/${s.id}/pdf`,
  }));

  return (
    <Card title={t("cardTitle")}>
      {rows.length === 0 ? (
        <EmptyState
          icon="📄"
          title={t("emptyTitle")}
          message={t("emptyMessage")}
          action={<Link href="/hr/payroll" className="btn primary">{t("goToPayrollRunsLink")}</Link>}
        />
      ) : (
        <DataTable<Row>
          columns={columns}
          rows={rows}
          rowLinkPrefix="/hr/payroll/salary-slips/"
          rowLinkKey="id"
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={20}
          emptyTitle={t("noMatchTitle")}
          emptyMessage={t("noMatchMessage")}
        />
      )}
    </Card>
  );
}
