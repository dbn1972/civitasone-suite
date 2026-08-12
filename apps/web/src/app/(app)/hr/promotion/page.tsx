import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { PromoteWithApproval } from "./PromoteWithApproval";

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

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/promotions", [], {
    telemetryKey: "hr.promotion",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function PromotionPage() {
  const { data: items, source } = await getData();

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
      <PageHeader title="Promotions" subtitle="Promotion orders with grade progression details." back="/hr" actions={<PromoteWithApproval />} />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="⬆️" iconBg="#e6f7f0" label="Total Promotions" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Completed" value={completed} />
      </StatGrid>
      <Card title="Promotions">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, department or grade…"
          pageSize={15}
          emptyIcon="📈"
          emptyTitle="No promotion orders"
          emptyMessage="Promotion orders appear here once raised and approved. Use '+ Raise Promotion' to initiate a grade progression."
        />
      </Card>
    </main>
  );
}
