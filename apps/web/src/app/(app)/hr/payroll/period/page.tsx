import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  month: string;
  runDate: string;
  employeesProcessed: string;
  grossPayout: string;
  netPayout: string;
  deductions: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/finance/periods", [], {
    telemetryKey: "finance.periods",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function PayrollPeriodPage() {
  const items = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "month", label: "Month" },
    { key: "runDate", label: "Run Date" },
    { key: "employeesProcessed", label: "Employees", align: "right" },
    { key: "grossPayout", label: "Gross", align: "right" },
    { key: "netPayout", label: "Net Payout", align: "right" },
    { key: "deductions", label: "Deductions", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Payroll Periods" subtitle="Monthly payroll run history and processing status." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…" pageSize={15} />
      </div>
    </main>
  );
}
