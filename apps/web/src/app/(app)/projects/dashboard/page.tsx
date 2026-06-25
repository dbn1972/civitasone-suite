import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectsDashboard, getProjects, getSchemes } from "../../../_data/loaders";
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  EmptyState,
} from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { DashboardProjectsTable, type DashboardProjectRow } from "./DashboardProjectsTable";

export default async function ProjectsDashboardPage() {
  const [dashResult, projResult, schemeResult] = await Promise.all([
    getProjectsDashboard(),
    getProjects(),
    getSchemes(),
  ]);

  const { data, source } = dashResult;
  const projects = projResult.data;
  const schemes = schemeResult.data;
  const anyError =
    source === "error" || projResult.source === "error" || schemeResult.source === "error";

  // totalOutlay is held in paise (minor units). 1 crore = 1e7 rupees = 1e9 paise.
  const outlayInCrores = Math.round(data.totalOutlay / 1e9);

  const rows: DashboardProjectRow[] = projects.map((p) => ({
    id: p.id,
    projectCode: p.projectCode,
    name: p.name,
    scheme: p.scheme ?? "—",
    department: p.department ?? "—",
    totalBudget: p.totalBudget,
    completionPct: p.completionPct,
    status: p.status,
  }));

  return (
    <>
      <PageHeader
        title="PMU Dashboard"
        subtitle="Real-time project monitoring — schemes, funds and delays."
      />
      {anyError && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#eef0fe" label="Schemes" value={schemes.length} />
        <StatCard icon="📁" iconBg="#eff6ff" label="Projects" value={data.totalProjects.toLocaleString("en-IN")} />
        <StatCard
          icon="💰"
          iconBg="#ecfdf3"
          label="Outlay (FY)"
          value={`₹${outlayInCrores.toLocaleString("en-IN")} Cr`}
        />
        <StatCard
          icon="🔴"
          iconBg="#fef3f2"
          label="Delayed (Red)"
          value={data.delayed.toLocaleString("en-IN")}
        />
      </StatGrid>
      <Card title="Projects">
        {rows.length === 0 ? (
          <EmptyState
            icon="📁"
            title="No projects yet"
            message="Projects will appear here once schemes are sanctioned and projects created."
          />
        ) : (
          <DashboardProjectsTable rows={rows} />
        )}
      </Card>
    </>
  );
}
