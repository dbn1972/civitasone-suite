import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectById } from "../../../_data/loaders";
import { PageHeader, Card, StatusPill, EmptyState } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { ProjectGantt } from "./ProjectGantt";
import { ProjectDetailActions } from "./ProjectDetailActions";
import { MilestonesDetailTable, FundReleasesDetailTable } from "./ProjectDetailTables";

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { data: project, source } = await getProjectById(params.id);

  if (!project) {
    return (
      <>
        <PageHeader title="Project Not Found" back="/projects/list" />
        <Card>
          <EmptyState
            icon="🔍"
            title="Project not found"
            message="No project exists for the given ID. It may have been removed."
          />
        </Card>
      </>
    );
  }

  const milestoneRows = project.milestones.map((m) => ({ ...m }));
  const fundReleaseRows = project.fundReleases.map((r) => ({ ...r }));

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
          <div className="fld"><div className="l">Start Date</div><div className="v">{formatIndianDate(project.startDate)}</div></div>
          <div className="fld"><div className="l">Expected End</div><div className="v">{formatIndianDate(project.expectedEndDate)}</div></div>
          <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={project.status} /></div></div>
          <div className="fld"><div className="l">Budget</div><div className="v">{formatMoney(project.totalBudget)}</div></div>
          <div className="fld"><div className="l">Expenditure</div><div className="v">{formatMoney(project.expenditure)}</div></div>
          <div className="fld"><div className="l">Completion %</div><div className="v">{project.completionPct.toFixed(1)}%</div></div>
        </div>
      </Card>
      <Card title="Milestones">
        {milestoneRows.length === 0 ? (
          <EmptyState icon="📋" title="No milestones" message="No milestones have been defined for this project." />
        ) : (
          <MilestonesDetailTable rows={milestoneRows} />
        )}
      </Card>
      <Card title="Milestone Timeline">
        {project.milestones.length === 0 ? (
          <EmptyState icon="📈" title="No timeline" message="The timeline appears once milestones are defined." />
        ) : (
          <div style={{ padding: 16 }}>
            <ProjectGantt milestones={project.milestones} projectStart={project.startDate} projectEnd={project.expectedEndDate} />
          </div>
        )}
      </Card>
      <Card title="Fund Releases">
        {fundReleaseRows.length === 0 ? (
          <EmptyState icon="💰" title="No fund releases" message="No funds have been released against this project yet." />
        ) : (
          <FundReleasesDetailTable rows={fundReleaseRows} />
        )}
      </Card>
    </>
  );
}
