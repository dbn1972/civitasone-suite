import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { GoalsProgressRing, type CategoryScore } from "./_components/GoalsProgressRing";
import { GoalTrackerCard } from "./_components/GoalTrackerCard";
import { DevelopmentPlanTimeline, type DevActivity } from "./_components/DevelopmentPlanTimeline";
import type { CascadeLevel } from "./_components/GoalTrackerCard";

type GoalRow = {
  id: string;
  employee: string;
  goal: string;
  title?: string;
  kra: string;
  target: string;
  actual: string;
  cycle: string;
  status: string;
  progress?: number;
  category?: string;
  due_date?: string | null;
  description?: string;
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
  return fetchJson<unknown, GoalRow[]>("/api/v1/hrms/goals", [], {
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

function buildCategoryScores(items: GoalRow[]): CategoryScore[] {
  const cats: Array<{ label: CategoryScore["label"]; color: string; keys: string[] }> = [
    { label: "Performance",   color: "#3b82f6", keys: ["performance","kra","kpi"] },
    { label: "Development",   color: "#10b981", keys: ["development","learning","training"] },
    { label: "Behavioural",   color: "#f59e0b", keys: ["behavioural","behavioral","soft"] },
    { label: "Organisational",color: "#8b5cf6", keys: ["org","organisational","organizational","strategic"] },
  ];

  return cats.map(({ label, color, keys }) => {
    const catItems = items.filter((i) => {
      const cat = (i.category ?? i.kra ?? "").toLowerCase();
      return keys.some((k) => cat.includes(k)) || label === "Organisational"; // fallback bucket
    });
    const achieved = catItems.filter((i) =>
      ["achieved","completed","on_track","on track"].includes((i.status ?? "").toLowerCase())
    ).length;
    return { label, total: catItems.length, achieved, color };
  });
}

function inferCascade(item: GoalRow): CascadeLevel {
  const cat = (item.category ?? "").toLowerCase();
  if (cat.includes("org") || cat.includes("strategic")) return "org";
  if (cat.includes("dept") || cat.includes("team")) return "dept";
  return "individual";
}

export default async function GoalsPage() {
  const [{ data: items, source }, { data: devPlans }] = await Promise.all([
    getGoals(),
    getDevPlans(),
  ]);

  const onTrack   = items.filter((i) => ["on_track","on track","active"].includes((i.status ?? "").toLowerCase())).length;
  const atRisk    = items.filter((i) => ["at_risk","behind","at risk"].includes((i.status ?? "").toLowerCase())).length;
  const completed = items.filter((i) => ["completed","achieved","closed"].includes((i.status ?? "").toLowerCase())).length;

  const categoryScores = buildCategoryScores(items);
  const overallScore   = items.length === 0 ? 0 : Math.round((completed / items.length) * 100);

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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Goals & Development"
        subtitle="Performance goals, OKRs, and development plans for the current appraisal cycle."
        back="/hr"
      />
      <DataSourceBadge source={source} />

      {/* Summary stats */}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total Goals" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="On Track" value={onTrack} />
        <StatCard icon="⚠️" iconBg="#fff7e6" label="At Risk / Behind" value={atRisk} />
        <StatCard icon="🏆" iconBg="#f5f5f5" label="Completed" value={completed} />
      </StatGrid>

      {/* Progress rings summary */}
      {items.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <Card title="Goal Achievement by Category">
            <div style={{ padding: "12px 0" }}>
              <GoalsProgressRing categories={categoryScores} overallScore={overallScore} />
            </div>
          </Card>
        </div>
      )}

      {/* Individual goal tracker cards */}
      <Card title="My Goals">
        {items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
            <p style={{ fontSize: 32, margin: "0 0 8px" }}>🎯</p>
            <p style={{ fontWeight: 600, color: "#475569", margin: 0 }}>No goals set</p>
            <p style={{ fontSize: 13, margin: "4px 0 0" }}>
              Goals are assigned during the appraisal cycle. Create an appraisal to assign objectives.
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
            {items.map((item) => (
              <GoalTrackerCard
                key={item.id}
                id={item.id}
                title={item.title ?? item.goal}
                description={item.description as string | undefined}
                targetMetric={item.target}
                progress={item.progress ?? 0}
                status={(item.status ?? "active") as any}
                category={item.kra ?? item.category ?? "General"}
                dueDate={item.due_date as string | null}
                cascadeLevel={inferCascade(item)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Development Plan Timeline */}
      <Card title="Development Plan — Next 12 Months">
        <div style={{ padding: "8px 16px 16px" }}>
          <DevelopmentPlanTimeline activities={activities} />
        </div>
      </Card>
    </main>
  );
}
