import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "../../../_components/ds";
import { getTrainingPrograms } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { UpcomingPrograms } from "./_components/UpcomingPrograms";
import { ProgramCard } from "./_components/ProgramCard";

export default async function TrainingPage() {
  const { data: programs, source } = await getTrainingPrograms();

  const total = programs.length;
  const upcoming = programs.filter((p) => p.status === "upcoming").length;
  const ongoing = programs.filter((p) => p.status === "ongoing").length;
  const completed = programs.filter((p) => p.status === "completed").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Training Programs"
        subtitle="Capacity building and skill development initiatives."
        actions={
          <Link href="/hr/training/new" className="btn primary">+ New Program</Link>
        }
      />
      <DataSourceBadge source={source} />

      {total === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon="🏆"
            title="No programs scheduled"
            message="Schedule your first training program to build capacity and upskill your workforce."
            action={<Link href="/hr/training/new" className="btn primary">Schedule Program</Link>}
          />
        </div>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📋" iconBg="#f5f5f5" label="Total" value={total} />
            <StatCard icon="📅" iconBg="#e6f0ff" label="Upcoming" value={upcoming} />
            <StatCard icon="▶️" iconBg="#e6f7f0" label="Ongoing" value={ongoing} />
            <StatCard icon="✅" iconBg="#fffbe6" label="Completed" value={completed} />
          </StatGrid>

          {/* Upcoming Programs fast-access strip */}
          {upcoming > 0 && (
            <UpcomingPrograms programs={programs} />
          )}

          {/* Full program grid */}
          <Card title="All Training Programs">
            {programs.length > 0 ? (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {programs.map((p) => (
                  <ProgramCard
                    key={p.id}
                    program={p}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="📚"
                title="No training programmes"
                message="Training programmes appear here once created."
                action={<Link href="/hr/training/new" className="btn primary">+ New Program</Link>}
              />
            )}
          </Card>

          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/hr/training/nominations" className="btn ghost">View Nominations</Link>
            <Link href="/hr/training/feedback" className="btn ghost">Feedback Reports</Link>
          </div>
        </>
      )}
    </main>
  );
}
