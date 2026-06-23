import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectById } from "../../../_data/loaders";
import {
  PageHeader,
  Card,
  DataTable,
  StatusPill,
} from "@/app/_components/ds";
import { ProjectGantt } from "./ProjectGantt";
import { ProjectDetailActions } from "./ProjectDetailActions";
import type { ProjectDetail } from "@civitasone/types";

type MilestoneRow = ProjectDetail["milestones"][number] & Record<string, unknown>;
type FundReleaseRow = ProjectDetail["fundReleases"][number] & Record<string, unknown>;

const MILESTONE_COLUMNS: {
  key: keyof MilestoneRow & string;
  label: string;
  render?: (row: MilestoneRow) => React.ReactNode;
}[] = [
  { key: "title", label: "Milestone" },
  { key: "dueDate", label: "Due Date" },
  {
    key: "completedDate",
    label: "Completed",
    render: (r) => (r.completedDate as string | undefined) ?? "—",
  },
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusPill status={r.status as string} />,
  },
];

const FUND_RELEASE_COLUMNS: {
  key: keyof FundReleaseRow & string;
  label: string;
  align?: "left" | "right";
  render?: (row: FundReleaseRow) => React.ReactNode;
}[] = [
  { key: "releaseDate", label: "Release Date" },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    render: (r) => `₹${(r.amount as number).toLocaleString("en-IN")}`,
  },
  {
    key: "remarks",
    label: "Remarks",
    render: (r) => (r.remarks as string | undefined) ?? "—",
  },
];

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { data: project, source } = await getProjectById(params.id);

  if (!project) {
    return (
      <>
        <PageHeader title="Project Not Found" back="/projects/list" />
        <p className="text-slate-500">No project found for the given ID.</p>
      </>
    );
  }

  const milestoneRows: MilestoneRow[] = project.milestones.map((m) => ({ ...m }));
  const fundReleaseRows: FundReleaseRow[] = project.fundReleases.map((r) => ({ ...r }));

  return (
    <>
      <PageHeader
        back="/projects/list"
        title={project.name}
        subtitle={project.projectCode}
        actions={<ProjectDetailActions projectId={project.id} milestones={project.milestones} />}
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Details" padding>
        <div className="fields">
          <div className="fld"><div className="l">Department</div><div className="v">{project.department ?? "—"}</div></div>
          <div className="fld"><div className="l">Scheme</div><div className="v">{project.scheme ?? "—"}</div></div>
          <div className="fld"><div className="l">Start Date</div><div className="v">{project.startDate}</div></div>
          <div className="fld"><div className="l">Expected End</div><div className="v">{project.expectedEndDate ?? "—"}</div></div>
          <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={project.status} /></div></div>
          <div className="fld"><div className="l">Budget</div><div className="v">₹{project.totalBudget.toLocaleString("en-IN")}</div></div>
          <div className="fld"><div className="l">Expenditure</div><div className="v">₹{project.expenditure.toLocaleString("en-IN")}</div></div>
          <div className="fld"><div className="l">Completion %</div><div className="v">{project.completionPct.toFixed(1)}%</div></div>
        </div>
      </Card>
      <Card title="Milestones">
        <DataTable<MilestoneRow>
          columns={MILESTONE_COLUMNS}
          rows={milestoneRows}
        />
      </Card>
      <Card title="Milestone Timeline">
        <div style={{ padding: 16 }}>
          <ProjectGantt milestones={project.milestones} projectStart={project.startDate} projectEnd={project.expectedEndDate} />
        </div>
      </Card>
      <Card title="Fund Releases">
        <DataTable<FundReleaseRow>
          columns={FUND_RELEASE_COLUMNS}
          rows={fundReleaseRows}
        />
      </Card>
    </>
  );
}
