import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMilestones } from "../../../_data/loaders";
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  DataTable,
  StatusPill,
} from "@/app/_components/ds";
import type { MilestoneSummary } from "@civitasone/types";

type MilestoneRow = MilestoneSummary & Record<string, unknown>;

const COLUMNS: {
  key: keyof MilestoneRow & string;
  label: string;
  render?: (row: MilestoneRow) => React.ReactNode;
}[] = [
  { key: "projectName", label: "Project" },
  { key: "title", label: "Milestone Title" },
  { key: "dueDate", label: "Due Date" },
  {
    key: "completedDate",
    label: "Completed Date",
    render: (r) => (r.completedDate as string | undefined) ?? "—",
  },
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusPill status={r.status as string} />,
  },
];

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
        <DataTable<MilestoneRow>
          columns={COLUMNS}
          rows={rows}
        />
      </Card>
    </>
  );
}
