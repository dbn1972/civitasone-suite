import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CompetencyRadarChart, type CompetencyScore } from "./_components/CompetencyRadarChart";
import { AddFrameworkAction } from "./_components/AddFrameworkAction";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type Framework  = { id: string; name: string; description?: string; status: string } & Record<string, unknown>;
type Competency = { id: string; name: string; category: string; maxLevel?: number } & Record<string, unknown>;
// GAP-HR-COMPETENCY-04: display row -- category/maxLevel are re-mapped to
// human-readable strings server-side (see compRows below) before ever
// reaching DataTable, rather than via a column `render:` function. This page
// is a Server Component, and DataTable is "use client" -- passing a render
// function across that boundary is exactly the anti-pattern
// scripts/ci/datatable-render-guard.mjs exists to catch (see DataTable.tsx's
// own doc comment). Pre-formatting the row data server-side, the same way
// hr/disciplinary/page.tsx already does for its own `type`/`caseRef`
// columns, avoids it entirely.
type CompetencyDisplay = Omit<Competency, "category" | "maxLevel"> & { category: string; maxLevel: string };

/**
 * Mirrors services/hrms-service/src/modules/competency/routes.ts's own
 * HR_ROLES exactly -- POST .../frameworks is HR-only there.
 */
const COMPETENCY_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

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
//
// GAP-HR-COMPETENCY-01 (formal_decision, not covered by the published
// decision packet -- grep confirmed neither "competency" nor "COMPETENCY-01"
// appears anywhere in /tmp/hr-decision-packet.html): the bigger call (wire
// this to a real per-employee competency/employees/:id/profile view, which
// needs a viewer-employee-id resolution this page doesn't have today, vs.
// keep it illustrative and drop it once a real view exists elsewhere) is
// still open and left for product/orchestrator -- see this ticket's [~] in
// gaps/hr.md. What ships here is the containment step (fix_steps #1) that
// doesn't presuppose that answer: a badge that's impossible to miss, not
// just the pre-existing 12px footnote.
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

  const roles = getSessionRoles();
  const canManage = roles.some((r: string) => COMPETENCY_ADMIN_ROLES.includes(r));

  const active      = frameworks.filter((f) => f.status === "active").length;
  const technical   = competencies.filter((c) => c.category === "technical").length;
  const behavioural = competencies.filter((c) => ["behavioural","behavioral"].includes(c.category)).length;

  const radarScores = buildIllustrativeRadarScores();
  // HRMS peripheral medium findings, item 3: the stat cards above are
  // already honest (real 0s when there's genuinely no data, "—" on fetch
  // error). The radar chart must be too: it's illustrative sample data, not
  // derived from frameworks/competencies at all, so a brand-new tenant with
  // zero of either would otherwise show confident-looking fake proficiency
  // numbers directly beside those honest real zeros -- the exact
  // fabricated-data-next-to-real-zero-counts pattern this audit flags.
  // Gate it on there being *something* real configured to illustrate
  // against; show an honest empty state instead when there isn't.
  const hasCompetencyData = frameworks.length > 0 || competencies.length > 0;

  const fwCols: { key: keyof Framework & string; label: string; cellType?: "status" }[] = [
    { key: "name",        label: t("colFrameworkName") },
    { key: "description", label: t("colDescription") },
    { key: "status",      label: t("colStatus"), cellType: "status" },
  ];
  const compCols: { key: keyof CompetencyDisplay & string; label: string }[] = [
    { key: "name",     label: t("colCompetency") },
    { key: "category", label: t("colCategory") },
    { key: "maxLevel", label: t("colProficiencyLevels") },
  ];

  // GAP-HR-COMPETENCY-04: category/maxLevel used to print the raw API value
  // verbatim (a bare enum word, a bare integer) via DataTable's untyped
  // default `String(row[key])` rendering. Pre-format both into display
  // strings here (category -> translated label with a title-cased fallback
  // for any value not in the two known buckets, maxLevel -> "N levels").
  const compRows: CompetencyDisplay[] = competencies.map((c) => {
    const catKey = c.category?.toLowerCase();
    const category =
      catKey === "technical" ? t("categoryTechnical")
      : catKey === "behavioural" || catKey === "behavioral" ? t("categoryBehavioural")
      : c.category
        ? c.category.charAt(0).toUpperCase() + c.category.slice(1)
        : c.category;
    const maxLevel = c.maxLevel != null ? t("levelsCount", { n: c.maxLevel }) : "—";
    return { ...c, category, maxLevel };
  });

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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
              any individual employee's real assessment. Only rendered when
              there's real framework/competency data to illustrate against
              (see hasCompetencyData above) — otherwise an honest empty state
              is shown so no fabricated figures appear beside real zeros. */}
          <Card title={t("radarCardTitle")}>
            {hasCompetencyData ? (
              <>
                {/* GAP-HR-COMPETENCY-01: prominent, can't-miss marker -- the
                    chart's own title text below already says "sample data",
                    but this badge is the fix_steps #1 containment ask
                    specifically (a badge, not just title/footnote text). */}
                <div style={{ padding: "12px 16px 0" }}>
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                      background: "var(--warnbg, #fffbe6)", color: "var(--warn, #92600a)",
                      border: "1px solid var(--warnbd, #f5d78e)",
                      borderRadius: 20, padding: "3px 10px",
                    }}
                  >
                    ⚠️ {t("sampleDataBadge")}
                  </span>
                </div>
                <div style={{ padding: "12px 16px 20px", display: "flex", justifyContent: "center" }}>
                  <CompetencyRadarChart
                    scores={radarScores}
                    title={t("radarChartTitle")}
                  />
                </div>
                <p style={{ margin: "0 16px 16px", fontSize: 12, color: "var(--ink2, #475569)" }}>
                  {t("radarIllustrativeNote")}
                </p>
              </>
            ) : (
              <EmptyState
                icon="🏗️"
                title={t("radarEmptyTitle")}
                message={t("radarEmptyMessage")}
              />
            )}
          </Card>

          <Card
            title={t("frameworksCardTitle")}
            link={canManage ? <AddFrameworkAction /> : undefined}
          >
            <DataTable<Framework>
              columns={fwCols}
              rows={frameworks}
              sortable filterable
              filterPlaceholder={t("fwFilterPlaceholder")}
              pageSize={10}
              emptyIcon="🏗️"
              emptyTitle={t("fwEmptyTitle")}
              emptyMessage={canManage ? t("fwEmptyMessage") : t("fwEmptyMessageReadOnly")}
            />
          </Card>

          <div style={{ marginTop: 16 }}>
            <Card title={t("catalogueCardTitle")}>
              <DataTable<CompetencyDisplay>
                columns={compCols}
                rows={compRows}
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
    </div>
  );
}
