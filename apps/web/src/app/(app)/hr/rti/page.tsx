import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  referenceNo: string;
  applicantName: string;
  subject: string;
  receivedDate: string;
  dueDate: string;
  status: string;
  overdue: boolean;
  daysToDue: number;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/rti/requests", [], {
    telemetryKey: "hr.rti",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function RtiPage() {
  const { data: items, source } = await getData();

  const filed = items.filter((i) => i.status === "filed").length;
  const overdue = items.filter((i) => i.overdue).length;
  const disposed = items.filter((i) => i.status === "responded" || i.status === "closed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "referenceNo", label: "Reference No." },
    { key: "applicantName", label: "Applicant" },
    { key: "subject", label: "Subject" },
    { key: "receivedDate", label: "Received" },
    { key: "dueDate", label: "Due Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="RTI Requests"
        subtitle="Right to Information applications — 30-day SLA tracking and CPIO response workflow."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📂" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="🔔" iconBg="#fffbe6" label="Pending (Filed)" value={filed} />
        <StatCard icon="🔴" iconBg="#fff1f0" label="Overdue" value={overdue} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Disposed" value={disposed} />
      </StatGrid>
      <Card title="RTI Applications Register">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by reference, applicant or subject…"
          pageSize={15}
          emptyIcon="📂"
          emptyTitle="No RTI requests received"
          emptyMessage="RTI applications filed by citizens appear here. CPIO assigns them and responds within 30 days under the Right to Information Act, 2005."
        />
      </Card>
    </main>
  );
}
