"use client";

import { Card, DataTable } from "../../../../_components/ds";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";
import type { SalarySlipSummary } from "@civitasone/types";

type Row = SalarySlipSummary & { printHref: string };

const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
  { key: "employeeName", label: "Employee" },
  { key: "department", label: "Dept" },
  { key: "payPeriod", label: "Pay Period" },
  { key: "gross", label: "Gross", align: "right", cellType: "amount" },
  { key: "deductions", label: "Deductions", align: "right", cellType: "amount" },
  { key: "net", label: "Net", align: "right", cellType: "amount" },
  { key: "status", label: "Status", cellType: "status" },
];

export function SalarySlipsTable({ slips }: { slips: SalarySlipSummary[] }) {
  const rows: Row[] = slips.map((s) => ({
    ...s,
    printHref: `/api/proxy/v1/payroll/slips/${s.id}/pdf`,
  }));

  return (
    <Card title="All Salary Slips">
      <DataTable<Row> columns={columns} rows={rows} />
      {rows.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {rows.slice(0, 12).map((r) => (
            <PrintDocumentLink
              key={r.id}
              href={r.printHref}
              label={r.employeeName.split(" ")[0] ?? "Slip"}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
