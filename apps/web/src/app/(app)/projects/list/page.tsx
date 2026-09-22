import Link from "next/link";
import { getProjects } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, Term } from "@/app/_components/ds";
import { ProjectsTable, type ProjectRow } from "./ProjectsTable";

export default async function ProjectsListPage() {
  const { data: projects, source } = await getProjects();
  // ISSUE-8: these 4 tiles used to be computed from mismatched fields -- "On
  // Track" from a bare completionPct>50 threshold (no status scoping at
  // all), "At Risk"/"Delayed" from the *lifecycle* status enum's on_hold /
  // delayed values (mutually exclusive with "active" by construction, so
  // they could never describe a breakdown of the active projects above
  // them). None of the three read the project's actual RAG (green/amber/
  // red) signal, which is the only field that can distinguish "on track"
  // from "at risk" -- that's why the breakdown read 0/0/0 while Active read
  // a real 3. "delayed" status is the one lifecycle value the backend RAG
  // scheduler itself treats as "still active, just red" (project-service's
  // rag.ts) -- so the active bucket below includes it, and the 3 RAG tiles
  // always sum back to it.
  const activeProjects = projects.filter((p) => p.status === "active" || p.status === "delayed");
  const active = activeProjects.length;
  const onTrack = activeProjects.filter((p) => p.rag === "green").length;
  const atRisk = activeProjects.filter((p) => p.rag === "amber").length;
  const delayed = activeProjects.filter((p) => p.rag === "red").length;

  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    projectCode: p.projectCode,
    name: p.name,
    scheme: p.scheme ?? "—",
    department: p.department ?? "—",
    totalBudget: p.totalBudget,
    completionPct: `${p.completionPct.toFixed(1)}%`,
    status: p.status,
  }));

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={<>All projects with physical progress & <Term name="RAG" label="RAG status" />.</>}
        help="projects"
        actions={
          <Link href="/projects/new" className="btn primary">
            + New Project
          </Link>
        }
      />
      {/* UX-012: the data-source badge now lives inside ProjectsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <StatGrid>
        <StatCard icon="📁" iconBg="#eef0fe" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Track" value={onTrack} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="At Risk" value={atRisk} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Delayed" value={delayed} />
      </StatGrid>
      <Card title="Projects">
        <ProjectsTable rows={rows} source={source} />
      </Card>
    </>
  );
}
