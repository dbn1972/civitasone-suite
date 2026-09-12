import { getMilestones } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { MilestonesTable, type MilestoneRow } from "./MilestonesTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function MilestonesPage() {
  const result = await getMilestones();
  const { data: milestones } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const pending = errored ? null : milestones.filter((m) => m.status === "pending").length;
  const completed = errored ? null : milestones.filter((m) => m.status === "completed").length;
  const delayed = errored ? null : milestones.filter((m) => m.status === "delayed").length;

  const rows: MilestoneRow[] = milestones.map((m) => ({ ...m }));

  return (
    <>
      <PageHeader
        title="Milestones"
        subtitle="Define milestones, track achievement, trigger payment release."
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={errored ? "—" : milestones.length} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending ?? "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed ?? "—"} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Delayed" value={delayed ?? "—"} />
      </StatGrid>
      <Card title="Milestones">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "milestones" })} />
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
