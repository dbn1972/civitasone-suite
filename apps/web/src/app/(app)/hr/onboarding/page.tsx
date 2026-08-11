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
  progress: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/onboarding", [], {
    telemetryKey: "hr.onboarding",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function OnboardingPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "New Joinee" },
    { key: "department", label: "Department" },
    { key: "joiningDate", label: "Joining Date" },
    { key: "stepsCompleted", label: "Steps Done" },
    { key: "progress", label: "Progress" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Onboarding Tracker" subtitle="Onboarding checklist progress for new joinees." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="Onboarding Tasks">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or task…"
          pageSize={15}
          emptyIcon="👋"
          emptyTitle="No onboarding tasks"
          emptyMessage="Onboarding checklists appear here for new joiners, covering document collection, IT setup, and departmental induction."
        />
      </Card>
    </main>
  );
}
