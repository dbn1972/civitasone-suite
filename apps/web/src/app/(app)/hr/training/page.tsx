import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { getTrainingPrograms } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

type Row = {
  id: string;
  title: string;
  category: string;
  trainer: string;
  dates: string;
  enrolled: string;
  status: string;
} & Record<string, unknown>;

export default async function TrainingPage() {
  const { data: programs, source } = await getTrainingPrograms();

  const total = programs.length;
  const upcoming = programs.filter((p) => p.status === "upcoming").length;
  const ongoing = programs.filter((p) => p.status === "ongoing").length;
  const completed = programs.filter((p) => p.status === "completed").length;

  const rows: Row[] = programs.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    trainer: p.trainerName ?? "—",
    dates: `${formatIndianDate(p.startDate)} – ${formatIndianDate(p.endDate)}`,
    enrolled: p.maxCapacity != null ? `${p.enrolledCount} / ${p.maxCapacity}` : String(p.enrolledCount),
    status: p.status,
  }));

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "title", label: "Title" },
    { key: "category", label: "Category" },
    { key: "trainer", label: "Trainer" },
    { key: "dates", label: "Dates" },
    { key: "enrolled", label: "Enrolled", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Training Programs"
        subtitle="Capacity building and skill development initiatives."
        actions={
          <Link href="/hr/training/new" className="btn primary">+ New Program</Link>
        }
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total" value={total} />
        <StatCard icon="📅" iconBg="#e6f0ff" label="Upcoming" value={upcoming} />
        <StatCard icon="▶️" iconBg="#e6f7f0" label="Ongoing" value={ongoing} />
        <StatCard icon="✅" iconBg="#fffbe6" label="Completed" value={completed} />
      </StatGrid>
      <Card title="Training Programs">
        <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by title, category or trainer…"
          pageSize={15}
          emptyIcon="📚"
          emptyTitle="No training programmes"
          emptyMessage="Training programmes appear here once created. Click '+ New Program' to schedule a training."
        />
      </Card>
    </main>
  );
}
