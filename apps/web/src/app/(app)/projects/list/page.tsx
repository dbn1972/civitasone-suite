import Link from "next/link";
import { getProjects } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, Term } from "@/app/_components/ds";
import { getSessionRoles, hasAnyRole, PROJECT_WRITE_ROLES } from "@/lib/auth/roleGuard";
import { ProjectsTable, type ProjectRow } from "./ProjectsTable";

export default async function ProjectsListPage() {
  const { data: projects, source } = await getProjects();
  // GAP-PROJECTS-HOME-01: only create-capable roles see the "+ New Project"
  // action (mirrors project-service PROJ_ROLES; the server stays the gate).
  const canCreate = hasAnyRole(getSessionRoles(), PROJECT_WRITE_ROLES);
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
  // GAP-PROJECTS-LIST-01: on a failed fetch the tiles must read "—", not real
  // zeros, so an outage can't masquerade as a healthy all-zero portfolio.
  const errored = source === "error";
  const active = errored ? null : activeProjects.length;
  const onTrack = errored ? null : activeProjects.filter((p) => p.rag === "green").length;
  const atRisk = errored ? null : activeProjects.filter((p) => p.rag === "amber").length;
  const delayed = errored ? null : activeProjects.filter((p) => p.rag === "red").length;

  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    projectCode: p.projectCode,
    name: p.name,
    scheme: p.scheme ?? "—",
    department: p.department ?? "—",
    totalBudget: p.totalBudget,
    // GAP-PROJECTS-LIST-03: pass the numeric pct (sortable); format in the column.
    completionPct: p.completionPct,
    status: p.status,
    // GAP-PROJECTS-LIST-05: expose RAG per row.
    rag: p.rag ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={<>All projects with physical progress & <Term name="RAG" label="RAG status" after="." /></>}
        help="projects"
        actions={
          canCreate ? (
            <Link href="/projects/new" className="btn primary">
              + New Project
            </Link>
          ) : undefined
        }
      />
      {/* UX-012: the data-source badge now lives inside ProjectsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <StatGrid>
        <StatCard icon="📁" iconBg="#eef0fe" label="Active" value={active ?? "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Track" value={onTrack ?? "—"} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="At Risk" value={atRisk ?? "—"} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Delayed" value={delayed ?? "—"} />
      </StatGrid>
      {/* GAP-PROJECTS-LIST-04: the tiles summarise ACTIVE + DELAYED projects
          (the RAG breakdown only makes sense for in-flight work), while the
          table lists every status — say so, so a reviewer doesn't expect the
          tiles to sum to the row count. */}
      {!errored && (
        <p role="note" style={{ fontSize: 12, color: "#6b7280", margin: "0 0 8px" }}>
          Tiles cover active &amp; delayed projects ({activeProjects.length} of {projects.length}); the
          table below lists all statuses.
        </p>
      )}
      <Card title="Projects">
        <ProjectsTable rows={rows} source={source} />
      </Card>
    </>
  );
}
