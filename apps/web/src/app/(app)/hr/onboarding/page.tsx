import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  joiningDate: string;
  stepsCompleted: string;
  totalSteps: string;
  overdue: number;
  progress: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/onboarding", [], {
    telemetryKey: "hr.onboarding",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function OnboardingPage() {
  const { data: items, source } = await getData();

  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const overdue = items.filter((i) => i.status === "overdue" || Number(i.overdue) > 0).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "New Joinee" },
    { key: "department", label: "Department" },
    { key: "joiningDate", label: "Joining Date" },
    { key: "stepsCompleted", label: "Tasks Done" },
    { key: "progress", label: "Progress" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Onboarding Tracker"
        subtitle="Onboarding checklist progress for new joinees — document collection, IT setup, and departmental induction."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👋" iconBg="#e6f0ff" label="Total Onboarding" value={items.length} />
        <StatCard icon="🔄" iconBg="#fffbe6" label="In Progress" value={inProgress} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Completed" value={completed} />
        <StatCard icon="⚠️" iconBg="#fff1f0" label="Overdue Tasks" value={overdue} />
      </StatGrid>
      <Card title="Onboarding Status">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, department or status…"
          pageSize={15}
          emptyIcon="👋"
          emptyTitle="No onboarding in progress"
          emptyMessage="Onboarding checklists appear here when a new joinee is added. Each checklist tracks document collection, IT setup, access provisioning, and departmental induction milestones."
        />
      </Card>
    </main>
  );
}
