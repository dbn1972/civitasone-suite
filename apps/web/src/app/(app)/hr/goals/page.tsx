import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { GoalsProgressRing, type CategoryScore } from "./_components/GoalsProgressRing";
import { GoalTrackerCard, type GoalStatus } from "./_components/GoalTrackerCard";
import { DevelopmentPlanTimeline, type DevActivity } from "./_components/DevelopmentPlanTimeline";
import type { CascadeLevel } from "./_components/GoalTrackerCard";
import { getTranslations } from "next-intl/server";

type KeyResult = { title?: string; targetValue?: number; currentValue?: number; unit?: string };

// GAP-HR-GOALS-02: this used to be a made-up shape (kra/target/actual/
// employee/goal) that GET /v1/hrms/goals (pulse-routes.ts) never actually
// returns -- it returns id, title, description, category, keyResults,
// progress, status, dueDate, period. Aligned to the real response.
type GoalRow = {
  id: string;
  title: string;
  description?: string;
  category?: string; // "individual" | "team" | "organization" (goalCreateSchema)
  keyResults?: KeyResult[];
  progress?: number;
  status: string;
  dueDate?: string | null;
  period?: string | null;
} & Record<string, unknown>;

type DevPlan = {
  id: string;
  employee: string;
  title: string;
  type: DevActivity["type"];
  plannedDate: string;
  durationDays?: number;
  status: DevActivity["status"];
  skillTargeted?: string;
  priority: DevActivity["priority"];
} & Record<string, unknown>;

async function getGoals(): Promise<LoaderResult<GoalRow[]>> {
  // GAP-HR-GOALS-02: GET /v1/hrms/goals defaults to `status=active`
  // server-side (pulse-routes.ts) when no query param is sent at all --
  // completed goals were silently excluded from every stat/ring on this
  // page. `status=all` is the documented bypass the backend already
  // supports.
  return fetchJson<unknown, GoalRow[]>("/api/v1/hrms/goals?status=all", [], {
    telemetryKey: "hr.goals",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: GoalRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getDevPlans(): Promise<LoaderResult<DevPlan[]>> {
  return fetchJson<unknown, DevPlan[]>("/api/v1/hrms/development-plans", [], {
    telemetryKey: "hr.development-plans",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: DevPlan[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

/**
 * GAP-HR-GOALS-03: rebuilt against the real category enum (individual/team/
 * organization) instead of the four invented buckets (Performance/
 * Development/Behavioural/Organisational) that never matched it -- the old
 * version's `|| label === "Organisational"` fallback silently routed every
 * single goal into the Organisational ring regardless of its real category,
 * so that one ring always showed 100% of goals and the other three always
 * showed 0/0. Buckets with zero goals are dropped rather than shown as a
 * misleading 0%.
 */
function buildCategoryScores(
  items: GoalRow[],
  labels: { individual: string; team: string; organization: string },
): CategoryScore[] {
  const buckets: Array<{ key: string; label: string; color: string }> = [
    { key: "individual",   label: labels.individual,   color: "var(--info, #3b82f6)" },
    { key: "team",         label: labels.team,         color: "var(--good, #10b981)" },
    { key: "organization", label: labels.organization, color: "var(--violet, #8b5cf6)" },
  ];

  return buckets
    .map(({ key, label, color }) => {
      const catItems = items.filter((i) => (i.category ?? "individual") === key);
      // GAP-HR-GOALS-03: "achieved" now means completed/achieved only -- the
      // old version also counted on_track/active here, which is what the
      // separate "On Track" dashboard stat means, not "done".
      const achieved = catItems.filter((i) =>
        ["achieved", "completed"].includes((i.status ?? "").toLowerCase())
      ).length;
      return { label, total: catItems.length, achieved, color };
    })
    .filter((c) => c.total > 0);
}

function inferCascade(category: string | undefined): CascadeLevel {
  if (category === "organization") return "org";
  if (category === "team") return "dept";
  return "individual";
}

export default async function GoalsPage() {
  const t = await getTranslations("goals");
  const [{ data: items, source }, devPlansResult] = await Promise.all([
    getGoals(),
    getDevPlans(),
  ]);
  const { data: devPlans, source: devPlansSource } = devPlansResult;
  const errored = source === "error";
  // Audit: this page destructured only the goals loader's `source` and threw
  // away getDevPlans()'s own -- so a real backend failure on the dev-plans
  // fetch (the table backing it was never migrated; see the migration added
  // alongside this fix) rendered DevelopmentPlanTimeline with an empty
  // `activities` array, identical to a tenant that genuinely has none
  // planned. Tracked separately so the two sections can each show their own
  // honest state.
  const devPlansErrored = devPlansSource === "error";

  const onTrack   = items.filter((i) => ["on_track","on track","active"].includes((i.status ?? "").toLowerCase())).length;
  const atRisk    = items.filter((i) => ["at_risk","behind","at risk"].includes((i.status ?? "").toLowerCase())).length;
  const completed = items.filter((i) => ["completed","achieved","closed"].includes((i.status ?? "").toLowerCase())).length;

  const categoryScores = buildCategoryScores(items, {
    individual: t("categoryIndividual"),
    team: t("categoryTeam"),
    organization: t("categoryOrganisation"),
  });
  const overallScore   = items.length === 0 ? 0 : Math.round((completed / items.length) * 100); // ux-001-ok: divide-by-zero guard for a ratio, not a rendered empty-state

  const categoryLabel: Record<string, string> = {
    individual: t("categoryIndividual"),
    team: t("categoryTeam"),
    organization: t("categoryOrganisation"),
  };

  const activities: DevActivity[] = devPlans.map((d) => ({
    id:           d.id,
    title:        d.title,
    type:         d.type,
    plannedDate:  d.plannedDate,
    durationDays: d.durationDays,
    status:       d.status,
    skillTargeted:d.skillTargeted,
    priority:     d.priority,
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />

      {/* Summary stats */}
      <StatGrid>
<StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statOnTrack")} value={onTrack} />
        <StatCard icon="⚠️" iconBg="var(--warnbg, #fff7e6)" label={t("statAtRisk")} value={atRisk} />
        <StatCard icon="🏆" iconBg="var(--bg, #f5f5f5)" label={t("statCompleted")} value={completed} />
      </StatGrid>

      {/* Progress rings summary */}
      {categoryScores.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <Card title={t("achievementCardTitle")}>
            <div style={{ padding: "12px 0" }}>
              <GoalsProgressRing categories={categoryScores} overallScore={overallScore} />
            </div>
          </Card>
        </div>
      )}

      {/* Individual goal tracker cards */}
      <Card title={t("goalsCardTitle")}>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "goals" })} />
        ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--mut)" }}>
            <p style={{ fontSize: 32, margin: "0 0 8px" }}>🎯</p>
<p style={{ fontWeight: 600, color: "var(--ink2, #475569)", margin: 0 }}>{t("emptyTitle")}</p>
            <p style={{ fontSize: 13, margin: "4px 0 0" }}>
              {t("emptyMessage")}
            </p>
          </div>
        ) : (
          <div
            style={{
              padding: "12px 16px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 14,
            }}
          >
            {items.map((item) => {
              // GAP-HR-GOALS-02: "Target:" used to read item.target, a field
              // the API never sends -- built from the goal's first key
              // result (keyResults[], the field the API actually returns)
              // instead. Hidden (undefined) when a goal has none, same as
              // before.
              const kr = (item.keyResults ?? [])[0];
              const targetMetric = kr && kr.targetValue != null
                ? `${kr.title ?? ""}${kr.title ? ": " : ""}${kr.currentValue ?? 0}/${kr.targetValue}${kr.unit ? ` ${kr.unit}` : ""}`
                : undefined;
              return (
                <GoalTrackerCard
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  description={item.description as string | undefined}
                  targetMetric={targetMetric}
                  progress={item.progress ?? 0}
                  status={(item.status ?? "active") as GoalStatus}
                  category={categoryLabel[item.category ?? "individual"] ?? item.category ?? t("categoryIndividual")}
                  dueDate={(item.dueDate as string | null) ?? null}
                  cascadeLevel={inferCascade(item.category)}
                />
              );
            })}
          </div>
        )}
      </Card>

      {/* Development Plan Timeline */}
      <Card title={t("devPlanCardTitle")}>
        {devPlansErrored ? (
          <div className="pad">
            <LoadErrorState result={devPlansResult} area="development plans" />
          </div>
        ) : (
          <div style={{ padding: "8px 16px 16px" }}>
            <DevelopmentPlanTimeline activities={activities} />
          </div>
        )}
      </Card>
    </div>
  );
}
