import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  pfEmployee: string;
  pfEmployer: string;
  esi: string;
  professionalTax: string;
  nps: string;
  total: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/statutory-deductions", [], {
    telemetryKey: "payroll.statutory-deductions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function StatutoryPage() {
  const items = await getData();

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right" }[] = [
    { key: "employee", label: "Employee" },
    { key: "pfEmployee", label: "PF (Emp)" },
    { key: "pfEmployer", label: "PF (Empr)" },
    { key: "esi", label: "ESI" },
    { key: "professionalTax", label: "Prof. Tax" },
    { key: "nps", label: "NPS" },
    { key: "total", label: "Total Statutory", align: "right" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Statutory Deductions" subtitle="PF, ESI, Professional Tax, and NPS contribution breakdown." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…" pageSize={15} />
      </div>
    </main>
  );
}
