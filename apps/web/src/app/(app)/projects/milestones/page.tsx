import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMilestones } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { MilestonesTable, type MilestoneRow } from "./MilestonesTable";

export default async function MilestonesPage() {
  const { data: milestones, source } = await getMilestones();

  const pending = milestones.filter((m) => m.status === "pending").length;
  const completed = milestones.filter((m) => m.status === "completed").length;
  const delayed = milestones.filter((m) => m.status === "delayed").length;

  const rows: MilestoneRow[] = milestones.map((m) => ({ ...m }));

  return (
    <>
      <PageHeader
        title="Milestones"
        subtitle="Define milestones, track achievement, trigger payment release."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={milestones.length} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Delayed" value={delayed} />
      </StatGrid>
      <Card title="Milestones">
        {rows.length === 0 ? (
          <EmptyState icon="📋" title="No milestones" message="No milestones have been defined across projects yet." />
        ) : (
          <MilestonesTable rows={rows} />
        )}
      </Card>
    </>
  );
}
