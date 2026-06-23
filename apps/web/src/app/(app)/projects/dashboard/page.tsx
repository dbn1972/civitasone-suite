import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectsDashboard, getProjects, getSchemes } from "../../../_data/loaders";
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  DataTable,
  StatusPill,
} from "@/app/_components/ds";
import type { ProjectSummary } from "@civitasone/types";


type ProjectRow = Pick<ProjectSummary, "id" | "projectCode" | "name" | "scheme" | "department" | "totalBudget" | "completionPct" | "status"> & Record<string, unknown>;

const PROJECT_COLUMNS: { key: keyof ProjectRow & string; label: string; align?: "left" | "right"; render?: (row: ProjectRow) => React.ReactNode }[] = [
  { key: "projectCode", label: "Project ID" },
  { key: "name", label: "Name" },
  { key: "scheme", label: "Scheme", render: (r) => r.scheme ?? "—" },
  { key: "department", label: "Dept", render: (r) => r.department ?? "—" },
  {
    key: "totalBudget",
    label: "Budget",
    align: "right",
    render: (r) => `₹${((r.totalBudget as number) / 100).toLocaleString("en-IN")}`,
  },
  {
    key: "completionPct",
    label: "Completion %",
    align: "right",
    render: (r) => `${(r.completionPct as number).toFixed(1)}%`,
  },
  {
    key: "status",
    label: "RAG Status",
    render: (r) => (
      <StatusPill status={r.status as string} label={String(r.status)} />
    ),
  },
];

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

  const outlayInCrores = Math.round(data.totalOutlay / 100 / 100000);

  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    projectCode: p.projectCode,
    name: p.name,
    scheme: p.scheme,
    department: p.department,
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
        <DataTable<ProjectRow>
          columns={PROJECT_COLUMNS}
          rows={rows}
          rowHref={(r) => `/projects/${r.id}`}
        />
      </Card>
    </>
  );
}
