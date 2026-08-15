import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { SkillMatrix, type SkillRecord } from "./_components/SkillMatrix";

type Row = {
  id: string;
  employee: string;
  department: string;
  skill: string;
  category: string;
  proficiency: string;
  assessedBy: string;
  lastAssessed: string;
} & Record<string, unknown>;

const LEVEL_MAP: Record<string, number> = {
  expert: 4, advanced: 4,
  proficient: 3,
  developing: 2, intermediate: 2,
  beginner: 1, basic: 1,
};

function toLevel(proficiency: string): 0 | 1 | 2 | 3 | 4 {
  const lvl = LEVEL_MAP[(proficiency ?? "").toLowerCase()] ?? 0;
  return lvl as 0 | 1 | 2 | 3 | 4;
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/skills", [], {
    telemetryKey: "hr.skills",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function SkillsPage() {
  const { data: items, source } = await getData();

  const expert   = items.filter((i) => ["expert","advanced"].includes((i.proficiency ?? "").toLowerCase())).length;
  const beginner = items.filter((i) => ["beginner","basic"].includes((i.proficiency ?? "").toLowerCase())).length;
  const employees = new Set(items.map((i) => i.employee)).size;

  const matrixRecords: SkillRecord[] = items.map((row) => ({
    skill:        row.skill,
    category:     row.category,
    employee:     row.employee,
    proficiency:  toLevel(row.proficiency),
    requiredLevel: 3, // default requirement — org can configure this per role
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Skill Matrix"
        subtitle="Employee competency mapping, proficiency levels, and skill gap identification."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e6f0ff" label="Skill Records"        value={items.length} />
        <StatCard icon="👤" iconBg="#f5f5f5" label="Employees Mapped"     value={employees} />
        <StatCard icon="⭐" iconBg="#fffbe6" label="Expert / Advanced"    value={expert} />
        <StatCard icon="📚" iconBg="#fff1f0" label="Beginner / Basic"     value={beginner} />
      </StatGrid>

      <Card title="Competency Grid">
        <div style={{ padding: "12px 16px 16px" }}>
          {matrixRecords.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
              <p style={{ fontSize: 32, margin: "0 0 8px" }}>🎯</p>
              <p style={{ fontWeight: 600, color: "#475569", margin: 0 }}>No skill assessments recorded</p>
              <p style={{ fontSize: 13, margin: "4px 0 0" }}>
                Skills appear after formal assessments during onboarding or training completions.
              </p>
            </div>
          ) : (
            <SkillMatrix records={matrixRecords} />
          )}
        </div>
      </Card>
    </main>
  );
}
