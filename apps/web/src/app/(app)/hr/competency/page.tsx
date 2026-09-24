import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CompetencyRadarChart, type CompetencyScore } from "./_components/CompetencyRadarChart";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

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

// SEC/UX audit: this radar previously fabricated "current" by reusing the
// competency DEFINITION's maxLevel (the org-wide proficiency ceiling, e.g.
// 5) as if it were an individual employee's ACHIEVED score, and hardcoded
// "required: 4" for every competency -- both rendered as if they were real
// analytics, with nothing telling the viewer otherwise. This page has no
// per-employee context at all (no :id in its route, no "current viewer's
// own employee id" resolution anywhere here, unlike e.g.
// competency/employees/:id/profile), so there is no real achieved score to
// plug in without inventing a new backend lookup. Rather than keep
// presenting synthetic numbers as analytics, this is now explicit
// illustrative sample data -- fixed, clearly not derived from any real
// employee's record -- and the chart/card copy below says so.
const ILLUSTRATIVE_SAMPLE_SCORES: Record<(typeof CORE_COMPETENCIES)[number], number> = {
  "Domain Knowledge": 3,
  "Leadership": 2,
  "Communication": 4,
  "Problem Solving": 3,
  "Team Work": 4,
  "Integrity": 4,
};

function buildIllustrativeRadarScores(): CompetencyScore[] {
  return CORE_COMPETENCIES.map((label) => ({
    label,
    current: ILLUSTRATIVE_SAMPLE_SCORES[label],
    required: 4, // illustrative org baseline — not pulled from real role requirements on this page
  }));
}

export default async function CompetencyPage() {
  const t = await getTranslations("competency");
  const [fw, comp] = await Promise.all([getFrameworks(), getCompetencies()]);
  const frameworks  = fw.data;
  const competencies = comp.data;
  const source = fw.source === "error" || comp.source === "error" ? "error" : fw.source;
  const errored = source === "error";

  const active      = frameworks.filter((f) => f.status === "active").length;
  const technical   = competencies.filter((c) => c.category === "technical").length;
  const behavioural = competencies.filter((c) => ["behavioural","behavioral"].includes(c.category)).length;

  const radarScores = buildIllustrativeRadarScores();

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
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
<StatCard icon="🏗️" iconBg="var(--infobg, #e6f0ff)" label={t("statFrameworks")}  value={errored ? null : frameworks.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)"  label={t("statActive")}      value={errored ? null : active} />
        <StatCard icon="💻" iconBg="var(--warnbg, #fffbe6)"  label={t("statTechnical")}   value={errored ? null : technical} />
        <StatCard icon="🤝" iconBg="var(--bg, #f5f5f5)"  label={t("statBehavioural")} value={errored ? null : behavioural} />
      </StatGrid>

      {errored ? (
        <Card title={t("radarCardTitle")}>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "competency" })} backHref="/hr" />
          </div>
        </Card>
      ) : (
        <>
          {/* Radar chart — core 6 government competencies. Illustrative sample
              data (see buildIllustrativeRadarScores above): not yet wired to
              any individual employee's real assessment. */}
          <Card title={t("radarCardTitle")}>
            <div style={{ padding: "12px 16px 20px", display: "flex", justifyContent: "center" }}>
              <CompetencyRadarChart
                scores={radarScores}
                title="Illustrative Proficiency Comparison (sample data, scale 0–5)"
              />
            </div>
            <p style={{ margin: "0 16px 16px", fontSize: 12, color: "var(--ink2, #475569)" }}>
              {t("radarIllustrativeNote")}
            </p>
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
        </>
      )}
    </main>
  );
}
