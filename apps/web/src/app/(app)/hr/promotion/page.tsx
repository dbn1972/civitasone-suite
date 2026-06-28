import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  fromGrade: string;
  toGrade: string;
  effectiveDate: string;
  orderNo: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/promotions", [], {
    telemetryKey: "hr.promotion",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function PromotionPage() {
  const items = await getData();

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "fromGrade", label: "From Grade" },
    { key: "toGrade", label: "To Grade" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "orderNo", label: "Order No." },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Promotions" subtitle="Promotion orders with grade progression details." back="/hr" />
      <StatGrid>
        <StatCard icon="⬆️" iconBg="#e6f7f0" label="Total Promotions" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Completed" value={completed} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Promotion Orders</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, department or grade…" pageSize={15} />
      </div>
    </main>
  );
}
