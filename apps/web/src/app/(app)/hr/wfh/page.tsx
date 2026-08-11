import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  fromDate: string;
  toDate: string;
  days: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/wfh-requests", [], {
    telemetryKey: "hr.wfh-requests",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function WfhPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "fromDate", label: "From" },
    { key: "toDate", label: "To" },
    { key: "days", label: "Days" },
    { key: "reason", label: "Reason" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Work From Home Requests" subtitle="WFH requests and approval status." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="WFH Requests">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or department…"
          pageSize={15}
          emptyIcon="🏠"
          emptyTitle="No WFH requests"
          emptyMessage="Work-from-home requests appear here once employees raise them. Requests are approved by the reporting officer."
        />
      </Card>
    </main>
  );
}
