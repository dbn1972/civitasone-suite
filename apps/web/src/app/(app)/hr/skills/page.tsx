import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { SkillMatrix, type SkillRecord } from "./_components/SkillMatrix";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { HR_SELF_SERVICE_ROLES } from "@/lib/auth/workRoles";
import { SKILL_BASELINE_LEVEL, toLevel } from "@/lib/skillLevels";

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
  requireAnyRole(HR_SELF_SERVICE_ROLES);
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
    // GAP-HR-SKILLS-03: one baseline for every skill, named in the matrix
    // legend; there is no per-role requirement API to read yet.
    requiredLevel: SKILL_BASELINE_LEVEL,
  }));

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🎯" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? "—" : total} />
        <StatCard icon="👤" iconBg="var(--bg)" label={t("statEmployees")} value={errored ? "—" : employees} />
        <StatCard icon="⭐" iconBg="var(--warnbg)" label={t("statExpert")} value={errored ? "—" : expert} />
        <StatCard icon="📚" iconBg="var(--badbg)" label={t("statBeginner")} value={errored ? "—" : beginner} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        <div style={{ padding: "12px 16px 16px" }}>
          {errored ? (
            <RefreshErrorState error={toHumanError("load", { area: "skill matrix" })} backHref="/hr" />
          ) : matrixRecords.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--mut)" }}>
              <p style={{ fontSize: 32, margin: "0 0 8px" }}>🎯</p>
              <p style={{ fontWeight: 600, color: "var(--ink2)", margin: 0 }}>{t("emptyTitle")}</p>
              <p style={{ fontSize: 13, margin: "4px 0 0" }}>{t("emptyMessage")}</p>
            </div>
          ) : (
            <>
              <SkillMatrix records={matrixRecords} baselineLevel={SKILL_BASELINE_LEVEL} />
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
