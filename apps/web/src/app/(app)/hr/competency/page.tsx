import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Framework = { id: string; name: string; description?: string; status: string } & Record<string, unknown>;
type Competency = { id: string; name: string; category: string; maxLevel?: number } & Record<string, unknown>;

async function getFrameworks(): Promise<LoaderResult<Framework[]>> {
  return fetchJson<unknown, Framework[]>("/api/v1/hrms/competency/frameworks", [], {
    telemetryKey: "hr.competency.frameworks",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Framework[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getCompetencies(): Promise<LoaderResult<Competency[]>> {
  return fetchJson<unknown, Competency[]>("/api/v1/hrms/competency/competencies", [], {
    telemetryKey: "hr.competency.competencies",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Competency[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function CompetencyPage() {
  const [fw, comp] = await Promise.all([getFrameworks(), getCompetencies()]);
  const frameworks = fw.data;
  const competencies = comp.data;
  const source = fw.source === "error" || comp.source === "error" ? "error" : fw.source;

  const active = frameworks.filter((f) => f.status === "active").length;
  const technical = competencies.filter((c) => c.category === "technical").length;
  const behavioural = competencies.filter((c) => c.category === "behavioural" || c.category === "behavioral").length;

  const fwCols: { key: keyof Framework & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: "Framework Name" },
    { key: "description", label: "Description" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  const compCols: { key: keyof Competency & string; label: string }[] = [
    { key: "name", label: "Competency" },
    { key: "category", label: "Category" },
    { key: "maxLevel", label: "Proficiency Levels" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Competency Framework"
        subtitle="Competency architecture — frameworks, competency definitions, and role-to-competency mapping."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏗️" iconBg="#e6f0ff" label="Frameworks" value={frameworks.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="💻" iconBg="#fffbe6" label="Technical" value={technical} />
        <StatCard icon="🤝" iconBg="#f5f5f5" label="Behavioural" value={behavioural} />
      </StatGrid>
      <Card title="Competency Frameworks">
        <DataTable<Framework>
          columns={fwCols}
          rows={frameworks}
          sortable
          filterable
          filterPlaceholder="Filter by framework name…"
          pageSize={10}
          emptyIcon="🏗️"
          emptyTitle="No competency frameworks defined"
          emptyMessage="Competency frameworks define the architecture of skills and behaviours required across the organisation. Add a framework to begin mapping role requirements."
        />
      </Card>
      <div style={{ marginTop: 16 }}>
        <Card title="Competency Catalogue">
          <DataTable<Competency>
            columns={compCols}
            rows={competencies}
            sortable
            filterable
            filterPlaceholder="Filter by competency name or category…"
            pageSize={15}
            emptyIcon="📚"
            emptyTitle="No competencies defined"
            emptyMessage="Individual competencies within frameworks appear here. Each competency defines proficiency levels from beginner to expert."
          />
        </Card>
      </div>
    </main>
  );
}
