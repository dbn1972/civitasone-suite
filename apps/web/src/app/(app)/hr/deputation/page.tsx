import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  parentOrg: string;
  deputationOrg: string;
  fromDate: string;
  toDate: string;
  period: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/deputation", [], {
    telemetryKey: "hr.deputation",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DeputationPage() {
  const { data: items, source } = await getData();

  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "parentOrg", label: "Parent Org" },
    { key: "deputationOrg", label: "Deputation To" },
    { key: "fromDate", label: "From" },
    { key: "toDate", label: "To" },
    { key: "period", label: "Period" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Deputation" subtitle="Officers on deputation to other organisations." back="/hr" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e6f0ff" label="Total Deputations" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Completed" value={completed} />
      </StatGrid>
      <Card title="Deputation List">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee or organisation…"
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle="No deputation orders"
          emptyMessage="Deputation orders are raised when an officer is posted to a different organisation on temporary assignment. Use ‘+ New Deputation’ to create one."
        />
      </Card>
    </main>
  );
}
