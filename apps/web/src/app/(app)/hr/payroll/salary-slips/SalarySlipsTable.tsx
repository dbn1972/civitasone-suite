"use client";

import Link from "next/link";
import { Card, DataTable } from "../../../../_components/ds";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";
import type { SalarySlipSummary } from "@civitasone/types";

type Row = SalarySlipSummary & { printHref: string } & Record<string, unknown>;

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
    label: "Employee",
    render: (r) => (
      <Link href={`/hr/employees/${r.employeeId}`} style={{ color: "var(--primary-d)", fontWeight: 600 }}>
        {r.employeeName}
      </Link>
    ),
  },
  { key: "department", label: "Dept" },
  { key: "payPeriod", label: "Pay Period" },
  { key: "gross", label: "Gross", align: "right", cellType: "amount" },
  { key: "deductions", label: "Deductions", align: "right", cellType: "amount" },
  { key: "net", label: "Net", align: "right", cellType: "amount" },
  { key: "status", label: "Status", cellType: "status" },
  {
    key: "printHref",
    label: "Slip",
    align: "center",
    sortable: false,
    render: (r) => <PrintDocumentLink href={r.printHref} label="Print" />,
  },
];

export function SalarySlipsTable({ slips }: { slips: SalarySlipSummary[] }) {
  const rows: Row[] = slips.map((s) => ({
    ...s,
    printHref: `/api/proxy/v1/payroll/slips/${s.id}/pdf`,
  }));

  return (
    <Card title="All Salary Slips">
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowLinkPrefix="/hr/payroll/salary-slips/"
        rowLinkKey="id"
        sortable
        filterable
        filterPlaceholder="Filter by employee, department or period…"
        pageSize={20}
      />
    </Card>
  );
}
