import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  program: string;
  rating: string;
  contentRating: string;
  trainerRating: string;
  comments: string;
  submittedOn: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/training/feedback", [], {
    telemetryKey: "hr.training_feedback",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function TrainingFeedbackPage() {
  const items = await getData();

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: "Employee" },
    { key: "program", label: "Program" },
    { key: "rating", label: "Overall Rating" },
    { key: "contentRating", label: "Content" },
    { key: "trainerRating", label: "Trainer" },
    { key: "comments", label: "Comments" },
    { key: "submittedOn", label: "Submitted" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Training Feedback" subtitle="Post-training feedback and program ratings." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…" pageSize={15} />
      </div>
    </main>
  );
}
