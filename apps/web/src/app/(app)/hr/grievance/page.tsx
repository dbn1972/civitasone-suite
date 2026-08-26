import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type RawRow = {
  id: string;
  employee: string;
  department: string;
  category: string;
  filedDate: string;
  assignedTo: string;
  description: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string };

async function getData(): Promise<LoaderResult<RawRow[]>> {
  return fetchJson<unknown, RawRow[]>("/api/v1/hrms/grievances", [], {
    telemetryKey: "hr.grievances",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RawRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export default async function GrievancePage() {
  const { data: rawItems, source } = await getData();
  const items: Row[] = rawItems.map((r) => ({ ...r, caseRef: shortId(r.id) }));

  const opened = items.filter((i) => i.status === "opened" || i.status === "registered").length;
  const inquiry = items.filter((i) => i.status === "under_inquiry" || i.status === "in_progress").length;
  const closed = items.filter((i) => i.status === "closed" || i.status === "disposed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: "Ref No." },
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "category", label: "Grievance" },
    { key: "filedDate", label: "Filed Date" },
    { key: "assignedTo", label: "HR Officer" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Grievance Redressal"
        subtitle="Employee grievances, category tracking, and resolution pipeline."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total Cases" value={items.length} />
        <StatCard icon="🔴" iconBg="#fff1f0" label="Open" value={opened} />
        <StatCard icon="🔍" iconBg="#fffbe6" label="Under Inquiry" value={inquiry} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Disposed" value={closed} />
      </StatGrid>
      <Card title="Grievance Cases">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, category or assigned officer…"
          pageSize={15}
          emptyIcon="📋"
          emptyTitle="No grievances on record"
          emptyMessage="Grievance cases appear here when employees file formal complaints under CCS (Conduct) Rules. Cases are assigned to an HR officer and tracked through inquiry to disposal."
        />
      </Card>
    </main>
  );
}
