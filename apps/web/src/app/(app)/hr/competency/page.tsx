import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CompetencyRadarChart, type CompetencyScore } from "./_components/CompetencyRadarChart";
import { getTranslations } from "next-intl/server";

type Framework  = { id: string; name: string; description?: string; status: string } & Record<string, unknown>;
type Competency = { id: string; name: string; category: string; maxLevel?: number } & Record<string, unknown>;
type EmpProfile = { competencyId: string; competencyName?: string; currentLevel: number; requiredLevel?: number } & Record<string, unknown>;

async function getFrameworks(): Promise<LoaderResult<Framework[]>> {
  return fetchJson<unknown, Framework[]>("/api/v1/hrms/competency/frameworks", [], {
    telemetryKey: "hr.competency.frameworks",
    mapResponse: (p) => { const arr = Array.isArray(p) ? p : (p as { data?: Framework[] })?.data; return Array.isArray(arr) ? arr : null; },
  });
}

async function getCompetencies(): Promise<LoaderResult<Competency[]>> {
  return fetchJson<unknown, Competency[]>("/api/v1/hrms/competency/competencies", [], {
    telemetryKey: "hr.competency.competencies",
    mapResponse: (p) => { const arr = Array.isArray(p) ? p : (p as { data?: Competency[] })?.data; return Array.isArray(arr) ? arr : null; },
  });
}

// 6 core government competencies shown in the radar
const CORE_COMPETENCIES = [
  "Domain Knowledge",
  "Leadership",
  "Communication",
  "Problem Solving",
  "Team Work",
  "Integrity",
] as const;

function buildRadarScores(competencies: Competency[]): CompetencyScore[] {
  return CORE_COMPETENCIES.map((label) => {
    const found = competencies.find((c) => c.name?.toLowerCase().includes(label.toLowerCase()));
    return {
      label,
      current:  found ? Math.min(found.maxLevel ?? 3, 5) : 0,
      required: 4, // default org requirement — can be pulled from role requirements
    };
  });
}

export default async function CompetencyPage() {
  const t = await getTranslations("competency");
  const [fw, comp] = await Promise.all([getFrameworks(), getCompetencies()]);
  const frameworks  = fw.data;
  const competencies = comp.data;
  const source = fw.source === "error" || comp.source === "error" ? "error" : fw.source;

  const active      = frameworks.filter((f) => f.status === "active").length;
  const technical   = competencies.filter((c) => c.category === "technical").length;
  const behavioural = competencies.filter((c) => ["behavioural","behavioral"].includes(c.category)).length;

  const radarScores = buildRadarScores(competencies);

  const fwCols: { key: keyof Framework & string; label: string; cellType?: "status" }[] = [
    { key: "name",        label: t("colFrameworkName") },
    { key: "description", label: t("colDescription") },
    { key: "status",      label: t("colStatus"), cellType: "status" },
  ];
  const compCols: { key: keyof Competency & string; label: string }[] = [
    { key: "name",     label: t("colCompetency") },
    { key: "category", label: t("colCategory") },
    { key: "maxLevel", label: t("colProficiencyLevels") },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
<StatCard icon="🏗️" iconBg="var(--infobg, #e6f0ff)" label={t("statFrameworks")}  value={frameworks.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)"  label={t("statActive")}      value={active} />
        <StatCard icon="💻" iconBg="var(--warnbg, #fffbe6)"  label={t("statTechnical")}   value={technical} />
        <StatCard icon="🤝" iconBg="var(--bg, #f5f5f5)"  label={t("statBehavioural")} value={behavioural} />
      </StatGrid>

      {/* Radar chart — core 6 government competencies */}
      <Card title={t("radarCardTitle")}>
        <div style={{ padding: "12px 16px 20px", display: "flex", justifyContent: "center" }}>
          <CompetencyRadarChart
            scores={radarScores}
            title="Current vs Required Proficiency (scale 0–5)"
          />
        </div>
      </Card>

      <Card title={t("frameworksCardTitle")}>
        <DataTable<Framework>
          columns={fwCols}
          rows={frameworks}
          sortable filterable
          filterPlaceholder={t("fwFilterPlaceholder")}
          pageSize={10}
          emptyIcon="🏗️"
          emptyTitle={t("fwEmptyTitle")}
          emptyMessage={t("fwEmptyMessage")}
        />
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title={t("catalogueCardTitle")}>
          <DataTable<Competency>
            columns={compCols}
            rows={competencies}
            sortable filterable
            filterPlaceholder={t("compFilterPlaceholder")}
            pageSize={15}
            emptyIcon="📚"
            emptyTitle={t("compEmptyTitle")}
            emptyMessage={t("compEmptyMessage")}
          />
        </Card>
      </div>
    </main>
  );
}
