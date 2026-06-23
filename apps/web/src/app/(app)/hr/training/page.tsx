import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, StatusPill } from "../../../_components/ds";
import { getTrainingPrograms } from "../../../_data/loaders";
import type { TrainingProgramSummary } from "@civitasone/types";

export default async function TrainingPage() {
  const { data: programs, source } = await getTrainingPrograms();

  const total = programs.length;
  const upcoming = programs.filter((p) => p.status === "upcoming").length;
  const ongoing = programs.filter((p) => p.status === "ongoing").length;
  const completed = programs.filter((p) => p.status === "completed").length;

  const columns: { key: keyof TrainingProgramSummary & string; label: string; align?: "left" | "right"; render?: (row: TrainingProgramSummary) => React.ReactNode }[] = [
    { key: "title", label: "Title" },
    { key: "category", label: "Category" },
    { key: "trainerName", label: "Trainer", render: (r) => r.trainerName ?? "—" },
    {
      key: "startDate",
      label: "Dates",
      render: (r) => `${r.startDate} – ${r.endDate}`,
    },
    {
      key: "enrolledCount",
      label: "Enrolled",
      align: "right",
      render: (r) =>
        r.maxCapacity != null
          ? `${r.enrolledCount} / ${r.maxCapacity}`
          : String(r.enrolledCount),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusPill status={r.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Training Programs"
        subtitle="Capacity building and skill development initiatives."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total" value={total} />
        <StatCard icon="📅" iconBg="#e6f0ff" label="Upcoming" value={upcoming} />
        <StatCard icon="▶️" iconBg="#e6f7f0" label="Ongoing" value={ongoing} />
        <StatCard icon="✅" iconBg="#fffbe6" label="Completed" value={completed} />
      </StatGrid>
      <Card title="Training Programs">
        <DataTable<TrainingProgramSummary>
          columns={columns}
          rows={programs}
        />
      </Card>
    </>
  );
}
