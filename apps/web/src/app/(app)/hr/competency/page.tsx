import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CompetencyRadarChart } from "./_components/CompetencyRadarChart";
import { getMyProfile } from "../../../_data/loaders";
import { buildMyRadar, hasEnoughForRadar, type HeldLevel } from "./myProfile";
import { AddFrameworkAction } from "./_components/AddFrameworkAction";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type Framework  = { id: string; name: string; description?: string; status: string } & Record<string, unknown>;
type Competency = { id: string; name: string; category: string; maxLevel?: number; certifiedLevel?: number } & Record<string, unknown>;
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

/**
 * GAP-HR-COMPETENCY-01: the viewer's OWN recorded competency levels
 * (GET .../competency/employees/:id/profile; a bare employee may only read
 * their own, which is exactly what this asks for). The id comes from the
 * session's linked employee record (getMyProfile); an account with no linked
 * record has no profile to show.
 */
async function getMyHeldLevels(employeeId: string): Promise<LoaderResult<HeldLevel[]>> {
  return fetchJson<unknown, HeldLevel[]>(`/api/v1/hrms/competency/employees/${encodeURIComponent(employeeId)}/profile`, [], {
    telemetryKey: "hr.competency.myProfile",
    mapResponse: (p) => { const arr = Array.isArray(p) ? p : (p as { data?: HeldLevel[] })?.data; return Array.isArray(arr) ? arr : null; },
  });
}

export default async function CompetencyPage() {
  const t = await getTranslations("competency");
  const [fw, comp, me] = await Promise.all([getFrameworks(), getCompetencies(), getMyProfile()]);
  const myId = me.data?.id ?? null;
  const mine: LoaderResult<HeldLevel[]> = myId ? await getMyHeldLevels(myId) : { data: [], source: "api" };
  const frameworks  = fw.data;
  const competencies = comp.data;
  const source = fw.source === "error" || comp.source === "error" ? "error" : fw.source;
  const errored = source === "error";

  const roles = getSessionRoles();
  const canManage = roles.some((r: string) => COMPETENCY_ADMIN_ROLES.includes(r));

  const active      = frameworks.filter((f) => f.status === "active").length;
  const technical   = competencies.filter((c) => c.category === "technical").length;
  const behavioural = competencies.filter((c) => ["behavioural","behavioral"].includes(c.category)).length;

  const radar = buildMyRadar(mine.data, competencies);
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
    <div className="page-main wrap">
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
          {/* GAP-HR-COMPETENCY-01: the viewer's own recorded levels, not sample
              data. Three honest states: no linked employee record, a failed
              fetch, or too few recorded competencies to draw a shape. */}
          <Card title={t("myRadarCardTitle")}>
            {!myId ? (
              <EmptyState icon="👤" title={t("myNoProfileTitle")} message={t("myNoProfileMessage")} />
            ) : mine.source === "error" ? (
              <div className="pad">
                <RefreshErrorState error={toHumanError("load", { area: "your competency profile" })} backHref="/hr" />
              </div>
            ) : hasEnoughForRadar(radar) ? (
              <>
                <div style={{ padding: "12px 16px 20px", display: "flex", justifyContent: "center" }}>
                  <CompetencyRadarChart
                    scores={radar.scores}
                    maxValue={radar.maxValue}
                    requiredLabel={t("myRequiredLabel")}
                    title={t("myRadarChartTitle", { max: radar.maxValue })}
                  />
                </div>
                <p style={{ margin: "0 16px 16px", fontSize: 12, color: "var(--ink2, #475569)" }}>
                  {t("myRadarNote")}
                </p>
              </>
            ) : (
              <EmptyState icon="📈" title={t("myRadarEmptyTitle")} message={t("myRadarEmptyMessage")} />
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
