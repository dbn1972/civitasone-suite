import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CreateReimbursementForm } from "./CreateReimbursementForm";

type Row = {
  id: string;
  employee_id: string;
  category: string;
  amount_minor: number | string;
  bill_date: string | null;
  bill_ref: string | null;
  period: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/reimbursements", [], {
    telemetryKey: "payroll.reimbursements",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ReimbursementsPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "employee_id", label: "Employee" },
    { key: "category", label: "Category" },
    { key: "amount_minor", label: "Amount", align: "right", cellType: "amount" },
    { key: "period", label: "Period" },
    { key: "bill_ref", label: "Bill Ref" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  const totalMinor = items.reduce((sum, r) => sum + Number(r.amount_minor ?? 0), 0);
  const pendingCount = items.filter((r) => r.status === "submitted").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Reimbursements"
        subtitle="Employee expense reimbursement claims (medical, travel, LTA, and more)."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e6f0ff" label="Total Claims" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pendingCount} />
        <StatCard icon="💰" iconBg="#e6f7f0" label="Total Claimed" value={formatMoney(totalMinor)} />
      </StatGrid>

      <CreateReimbursementForm />

      <Card title="Reimbursement Claims">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee or category…"
          pageSize={15}
          emptyIcon="🧾"
          emptyTitle="No reimbursement claims yet"
          emptyMessage="Create your first claim using the form above."
        />
      </Card>
    </main>
  );
}
