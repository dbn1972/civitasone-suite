import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  program: string;
  rating: string;
  submittedOn: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/training/feedback", [], {
    telemetryKey: "hr.training_feedback",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function TrainingFeedbackPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: "Employee" },
    { key: "program", label: "Program" },
    { key: "rating", label: "Overall Rating" },
    { key: "submittedOn", label: "Submitted" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Training Feedback" subtitle="Post-training feedback and program ratings." back="/hr" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
        <StatCard icon="📚" iconBg="#e6f7f0" label="Programs" value={new Set(items.map((i) => i.program)).size} />
        <StatCard icon="👥" iconBg="#fffbe6" label="Employees" value={new Set(items.map((i) => i.employee)).size} />
        <StatCard icon="⭐" iconBg="#f5f5f5" label="Avg Rating" value={items.length > 0 ? (items.reduce((s, i) => s + (Number(i.rating) || 0), 0) / items.length).toFixed(1) : "—"} />
      </StatGrid>
      <Card title="Training Feedback">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…"
          pageSize={15}
          emptyIcon="📝"
          emptyTitle="No training feedback"
          emptyMessage="Employee feedback on completed training programmes appears here. Feedback is collected at programme closure."
        />
      </Card>
    </main>
  );
}
