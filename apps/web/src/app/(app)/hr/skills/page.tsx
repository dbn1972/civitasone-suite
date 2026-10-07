import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { SkillMatrix, type SkillRecord } from "./_components/SkillMatrix";
import { getTranslations } from "next-intl/server";

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

type SkillsPayload = {
  items: Row[];
  total: number;
  hasMore: boolean;
};

// GAP-HR-SKILLS-03: mapped 1:1 onto the backend's actual assessed_level
// vocabulary (beginner/intermediate/advanced/expert — see
// gap-features/routes.ts POST /v1/hrms/skills/assessments), plus the older
// synonyms the same endpoint's history could still hold. Level 3 was
// previously unreachable (both advanced and expert mapped to 4).
const LEVEL_MAP: Record<string, number> = {
  expert: 4,
  advanced: 3,
  proficient: 3, // legacy synonym
  intermediate: 2,
  developing: 2, // legacy synonym
  beginner: 1,
  basic: 1, // legacy synonym
};

function toLevel(proficiency: string): 0 | 1 | 2 | 3 | 4 {
  const lvl = LEVEL_MAP[(proficiency ?? "").toLowerCase()] ?? 0;
  return lvl as 0 | 1 | 2 | 3 | 4;
}

async function getData(): Promise<LoaderResult<SkillsPayload>> {
  return fetchJson<unknown, SkillsPayload>("/api/v1/hrms/skills", { items: [], total: 0, hasMore: false }, {
    telemetryKey: "hr.skills",
    mapResponse: (p) => {
      const payload = p as { data?: Row[]; meta?: { total?: number; hasMore?: boolean } } | Row[];
      const arr = Array.isArray(payload) ? payload : payload?.data;
      if (!Array.isArray(arr)) return null;
      const meta = Array.isArray(payload) ? undefined : payload?.meta;
      return { items: arr, total: meta?.total ?? arr.length, hasMore: meta?.hasMore ?? false };
    },
  });
}

export default async function SkillsPage() {
  const t = await getTranslations("skills");
  const { data, source } = await getData();
  const errored = source === "error";
  const { items, total, hasMore } = data;

  const expert = items.filter((i) => (i.proficiency ?? "").toLowerCase() === "expert").length;
  const beginner = items.filter((i) => ["beginner", "basic"].includes((i.proficiency ?? "").toLowerCase())).length;
  const employees = new Set(items.map((i) => i.employee)).size;

  const matrixRecords: SkillRecord[] = items.map((row) => ({
    skill: row.skill,
    category: row.category,
    employee: row.employee,
    proficiency: toLevel(row.proficiency),
    requiredLevel: 3, // baseline shown in the legend; see GAP-HR-SKILLS-03 fix notes
  }));

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🎯" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? "—" : total} />
        <StatCard icon="👤" iconBg="var(--bg, #f5f5f5)" label={t("statEmployees")} value={errored ? "—" : employees} />
        <StatCard icon="⭐" iconBg="var(--warnbg, #fffbe6)" label={t("statExpert")} value={errored ? "—" : expert} />
        <StatCard icon="📚" iconBg="var(--badbg, #fff1f0)" label={t("statBeginner")} value={errored ? "—" : beginner} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        <div style={{ padding: "12px 16px 16px" }}>
          {errored ? (
            <RefreshErrorState error={toHumanError("load", { area: "skill matrix" })} backHref="/hr" />
          ) : matrixRecords.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--mut)" }}>
              <p style={{ fontSize: 32, margin: "0 0 8px" }}>🎯</p>
              <p style={{ fontWeight: 600, color: "var(--ink2, #475569)", margin: 0 }}>{t("emptyTitle")}</p>
              <p style={{ fontSize: 13, margin: "4px 0 0" }}>{t("emptyMessage")}</p>
            </div>
          ) : (
            <>
              <SkillMatrix records={matrixRecords} />
              {hasMore && (
                <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 12 }}>
                  {t("truncationNotice", { shown: items.length, total })}
                </p>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
