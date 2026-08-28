import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { currentFinancialYear } from "@/lib/fiscalYear";

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

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/income-tax", [], {
    telemetryKey: "payroll.income-tax",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function IncomeTaxPage() {
  const { data: items, source: source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "employee", label: "Employee" },
    { key: "grossIncome", label: "Gross Income", align: "right" },
    { key: "deductions80C", label: "80C", align: "right" },
    { key: "otherDeductions", label: "Other Ded.", align: "right" },
    { key: "taxableIncome", label: "Taxable Income", align: "right" },
    { key: "taxPayable", label: "Tax Payable", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  const fy = currentFinancialYear();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Income Tax Computation" subtitle={`Annual IT computation summary for FY ${fy}.`} back="/hr" />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label="Total" value={items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Finalized" value={items.filter((i) => i.status === "finalized" || i.status === "completed").length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Pending" value={items.filter((i) => i.status === "pending" || i.status === "draft").length} />
        <StatCard icon="🏢" iconBg="var(--panel)" label="Departments" value={new Set(items.map((i) => i.department)).size} />
      </StatGrid>
      <Card title="Income Tax Declarations">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…"
          pageSize={15}
          emptyIcon="📊"
          emptyTitle="No income tax declarations"
          emptyMessage="Employee income tax declarations appear here once submitted during the declaration window."
        />
      </Card>
    </main>
  );
}
