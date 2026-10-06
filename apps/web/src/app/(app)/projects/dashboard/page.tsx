import { getProjectsDashboard, getProjects, getSchemes } from "../../../_data/loaders";
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  EmptyState,
  RefreshErrorState,
  Term,
} from "@/app/_components/ds";
import { formatCrore, formatPercent } from "@/lib/formatters";
import { DashboardProjectsTable, type DashboardProjectRow } from "./DashboardProjectsTable";
import { toHumanError } from "@/lib/messages";

export default async function ProjectsDashboardPage() {
  const [dashResult, projResult, schemeResult] = await Promise.all([
    getProjectsDashboard(),
    getProjects(),
    getSchemes(),
  ]);

  const { data, source } = dashResult;
  const projects = projResult.data;
  const schemes = schemeResult.data;
  // UX-013: this was already checking all 3 sources (unlike the disbursement
  // page's equivalent flag) -- it just wasn't wired to anything before. Now
  // it gates both the stat cards and the Projects table's empty-check.
  const anyError =
    source === "error" || projResult.source === "error" || schemeResult.source === "error";

  const rows: DashboardProjectRow[] = projects.map((p) => ({
    id: p.id,
    projectCode: p.projectCode,
    name: p.name,
    scheme: p.scheme ?? "—",
    department: p.department ?? "—",
    totalBudget: p.totalBudget,
    completionPct: p.completionPct,
    status: p.status,
    rag: p.rag ?? null,
  }));

  // GAP-PROJECTS-DASHBOARD-03: the "Projects" tile reports the dashboard
  // aggregate (data.totalProjects, counts every lifecycle status) while the
  // table below lists the rows returned by /project/projects. When those two
  // disagree we surface an honest footnote rather than letting a reviewer
  // assume the tile and the table describe the same set.
  const countsDiffer = !anyError && data.totalProjects !== rows.length;

  return (
    <>
      <PageHeader
        title={<><Term name="PMU" /> Dashboard</>}
        subtitle="Real-time project monitoring — schemes, funds and delays."
        help="projects"
        back="/projects"
      />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#eef0fe" label="Schemes" value={anyError ? "—" : schemes.length} />
        <StatCard icon="📁" iconBg="#eff6ff" label="Projects" value={anyError ? "—" : data.totalProjects.toLocaleString("en-IN")} />
        <StatCard
          icon="💰"
          iconBg="#ecfdf3"
          label="Total outlay"
          value={anyError ? "—" : formatCrore(data.totalOutlay)}
        />
        <StatCard
          icon="✅"
          iconBg="#f0fdf4"
          label="On Track"
          value={anyError ? "—" : formatPercent(data.onTrackPct)}
        />
        <StatCard
          icon="🔴"
          iconBg="#fef3f2"
          label="Delayed (Red)"
          value={anyError ? "—" : data.delayed.toLocaleString("en-IN")}
        />
      </StatGrid>
      <Card title="Projects">
        {anyError ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "projects" })} backHref="/projects" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📁"
            title="No projects yet"
            message="Projects will appear here once schemes are sanctioned and projects created."
          />
        ) : (
          <>
            {countsDiffer && (
              <p role="note" style={{ fontSize: 12, color: "#6b7280", margin: "0 0 8px" }}>
                Dashboard counts all {data.totalProjects.toLocaleString("en-IN")} projects across every
                status; the table below lists {rows.length.toLocaleString("en-IN")}.
              </p>
            )}
            <DashboardProjectsTable rows={rows} />
          </>
        )}
      </Card>
    </>
  );
}
