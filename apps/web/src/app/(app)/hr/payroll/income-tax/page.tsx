import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

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

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/income-tax", [], {
    telemetryKey: "payroll.income-tax",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function IncomeTaxPage() {
  const items = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "employee", label: "Employee" },
    { key: "grossIncome", label: "Gross Income", align: "right" },
    { key: "deductions80C", label: "80C", align: "right" },
    { key: "otherDeductions", label: "Other Ded.", align: "right" },
    { key: "taxableIncome", label: "Taxable Income", align: "right" },
    { key: "taxPayable", label: "Tax Payable", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Income Tax Computation" subtitle="Annual IT computation summary for FY 2024-25." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…" pageSize={15} />
      </div>
    </main>
  );
}
