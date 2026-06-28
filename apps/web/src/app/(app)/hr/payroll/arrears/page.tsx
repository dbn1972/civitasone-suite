import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  arrearType: string;
  period: string;
  amount: string;
  payableMonth: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/arrears", [], {
    telemetryKey: "payroll.arrears",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function ArrearsPage() {
  const items = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "arrearType", label: "Arrear Type" },
    { key: "period", label: "Period" },
    { key: "amount", label: "Amount" },
    { key: "payableMonth", label: "Payable In" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Arrears Computation" subtitle="Arrears due to DA revision, promotions, and pay fixation." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…" pageSize={15} />
      </div>
    </main>
  );
}
