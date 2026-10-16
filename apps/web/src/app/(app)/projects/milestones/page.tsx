import { getMilestones } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { MilestonesTable, type MilestoneRow } from "./MilestonesTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function MilestonesPage() {
  const result = await getMilestones();
  const { data: milestones } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const pending = errored ? null : milestones.filter((m) => m.status === "pending").length;
  const completed = errored ? null : milestones.filter((m) => m.status === "completed").length;
  const delayed = errored ? null : milestones.filter((m) => m.status === "delayed").length;

  const rows: MilestoneRow[] = milestones.map((m) => ({ ...m }));

  return (
    <>
      <PageHeader
        title="Milestones"
        subtitle="Milestone status across all projects. Open a project to record completion."
        back="/projects"
      />
      <StatGrid>
        <StatCard icon="📋" tone="info" label="Total" value={errored ? "—" : milestones.length} />
        <StatCard icon="⏳" tone="warn" label="Pending" value={pending ?? "—"} />
        <StatCard icon="✅" tone="good" label="Completed" value={completed ?? "—"} />
        <StatCard icon="🔴" tone="bad" label="Delayed" value={delayed ?? "—"} />
      </StatGrid>
      <Card title="Milestones">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "milestones" })} backHref="/projects" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📋" title="No milestones" message="No milestones have been defined across projects yet." />
        ) : (
          <MilestonesTable rows={rows} />
        )}
      </Card>
    </>
  );
}
