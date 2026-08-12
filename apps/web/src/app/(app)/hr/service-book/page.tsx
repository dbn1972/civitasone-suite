import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  eventType: string;
  fromPosting: string;
  toPosting: string;
  effectiveDate: string;
  orderNo: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/service-book", [], {
    telemetryKey: "hr.service-book",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ServiceBookPage() {
  const { data: items, source } = await getData();

  const transfers = items.filter((i) => i.eventType === "transfer" || i.eventType === "posting").length;
  const promotions = items.filter((i) => i.eventType === "promotion" || i.eventType === "increment").length;
  const employees = new Set(items.map((i) => i.employee).filter(Boolean)).size;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "eventType", label: "Event Type" },
    { key: "fromPosting", label: "From Posting" },
    { key: "toPosting", label: "To Posting" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "orderNo", label: "Order / Reference" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Service Book"
        subtitle="Official service history register — all postings, transfers, promotions, and administrative actions."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📒" iconBg="#e6f0ff" label="Total Entries" value={items.length} />
        <StatCard icon="👥" iconBg="#f5f5f5" label="Employees" value={employees} />
        <StatCard icon="🔄" iconBg="#fffbe6" label="Transfers / Postings" value={transfers} />
        <StatCard icon="📈" iconBg="#e6f7f0" label="Promotions / Increments" value={promotions} />
      </StatGrid>
      <Card title="Service Book Entries">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, event type, order no. or posting…"
          pageSize={15}
          emptyIcon="📒"
          emptyTitle="No service book entries"
          emptyMessage="Service book entries are the official record of an employee's complete service history — transfers, promotions, deputation, suspension, and retirement orders."
        />
      </Card>
    </main>
  );
}
