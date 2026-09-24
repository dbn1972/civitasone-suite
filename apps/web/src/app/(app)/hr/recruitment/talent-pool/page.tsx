import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState, Button } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";

// Mirrors HR_ROLES in services/hrms-service/src/modules/recruitment/routes.ts
// (GET /v1/hrms/talent-pool) -- kept local rather than shared, matching how
// the backend itself already re-declares this same list per route file.
const TALENT_POOL_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type Candidate = {
  id: string;
  applicantName: string;
  email: string | null;
  mobile: string | null;
  qualification: string | null;
  experienceYears: number | null;
  skills: string[] | null;
  source: string;
  stage: string;
  appliedAt: string;
} & Record<string, unknown>;

async function getCandidates(skill?: string, minExp?: string): Promise<LoaderResult<Candidate[]>> {
  let path = "/api/v1/hrms/talent-pool?limit=200";
  if (skill) path += `&skill=${encodeURIComponent(skill)}`;
  if (minExp) path += `&minExp=${encodeURIComponent(minExp)}`;
  const res = await fetchJson<unknown, Candidate[]>(path, [], {
    telemetryKey: "recruitment.talent_pool",
    mapResponse: (p) => {
      const d = (p as Record<string, unknown>)?.data;
      return Array.isArray(d) ? d as Candidate[] : null;
    },
  });
  return res;
}

export default async function TalentPoolPage({
  searchParams,
}: {
  searchParams: { skill?: string; minExp?: string };
}) {
  const t = await getTranslations("recruitmentTalentPool");
  const { data: candidates, source, status } = await getCandidates(searchParams.skill, searchParams.minExp);

  // A 403 here is a real, permanent role restriction (talent-pool search
  // spans every candidate across every vacancy tenant-wide, deliberately
  // HR-only -- see HR_ROLES in routes.ts), not a transient failure. Showing
  // the normal "Couldn't load -- try again" error state for it is actively
  // misleading: retrying will never succeed, and it reads as this page
  // being broken rather than as a role the viewer correctly doesn't have.
  // Skip the stats/filters/table entirely (none of it is meaningful with
  // zero access) and say plainly what's actually true.
  if (status === 403) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          back="/hr/recruitment"
          backLabel={t("backLabel")}
          help="hr"
        />
        <PermissionDenied module="the talent pool" requiredRoles={TALENT_POOL_ROLES} />
      </div>
    );
  }

  const withSkills  = candidates.filter((c) => c.skills && c.skills.length > 0).length;
  const experienced = candidates.filter((c) => (c.experienceYears ?? 0) >= 5).length;
  const activeStage = candidates.filter((c) => !["rejected","not_selected","withdrawn"].includes(c.stage)).length;

  const rows = candidates.map((c) => ({
    ...c,
    // Real data has both shapes for "no skills": a SQL NULL (skills == null)
    // and an empty array (skills == []). c.skills?.join(", ") only caught the
    // first -- an empty array produced "".join() === "" (a blank cell that
    // reads as a rendering glitch), not the placeholder every other empty
    // field in this table uses. Both shapes now render the same placeholder.
    skillsDisplay: c.skills && c.skills.length > 0 ? c.skills.join(", ") : "—",
    expDisplay: c.experienceYears != null ? t("expYearShort", { years: c.experienceYears }) : "—",
    appliedDate: new Date(c.appliedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/recruitment"
        backLabel={t("backLabel")}
        help="hr"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="\ud83d\udc65" iconBg="var(--infobg)" label={t("statTotalCandidates")}   value={candidates.length} />
        <StatCard icon="\ud83d\udca1" iconBg="var(--primary-soft)" label={t("statWithSkills")}        value={withSkills} />
        <StatCard icon="\ud83e\udde0" iconBg="var(--warnbg)" label={t("statExperienced")} value={experienced} />
        <StatCard icon="\u2705"       iconBg="var(--line2)" label={t("statActiveStages")}     value={activeStage} />
      </StatGrid>

      {/* Filters */}
      <Card padding>
        <form method="GET" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div>
            <label htmlFor="tp-skill" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 }}>{t("skillLabel")}</label>
            <input id="tp-skill" name="skill" defaultValue={searchParams.skill ?? ""} placeholder={t("skillPlaceholder")} className="input" style={{ minWidth: 180 }} />
          </div>
          <div>
            <label htmlFor="tp-exp" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 }}>{t("minExpLabel")}</label>
            <input id="tp-exp" name="minExp" type="number" min="0" defaultValue={searchParams.minExp ?? ""} placeholder={t("minExpPlaceholder")} className="input" style={{ width: 100 }} />
          </div>
          <Button type="submit" variant="primary" style={{ minHeight: 44 }}>{t("search")}</Button>
          <Link href="/hr/recruitment/talent-pool" className="btn ghost" style={{ minHeight: 44 }}>{t("clear")}</Link>
        </form>
      </Card>

      <Card title={t("candidatesTitle", { count: rows.length })}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "talent pool" })} backHref="/hr/recruitment" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="👥"
            title={t("noCandidatesFound")}
            message={searchParams.skill || searchParams.minExp
              ? t("noneMatchFilter")
              : t("candidatesAppearHere")
            }
            action={<Link href="/careers" target="_blank" className="btn ghost">{t("viewPublicCareersPage")}</Link>}
          />
        ) : (
          <DataTable
            columns={[
              { key: "applicantName", label: t("colName") },
              { key: "email", label: t("colEmail") },
              { key: "qualification", label: t("colQualification") },
              { key: "expDisplay", label: t("colExperience"), align: "right" },
              { key: "skillsDisplay", label: t("colSkills") },
              { key: "source", label: t("colSource"), cellType: "status" },
              { key: "stage", label: t("colStage"), cellType: "status" },
              { key: "appliedDate", label: t("colApplied") },
            ]}
            rows={rows}
            sortable
            filterable
        filterPlaceholder={t("filterPlaceholder")}
          emptyIcon="🧑‍💼"
          emptyTitle={t("emptyTitleNoCandidates")}
          emptyMessage={t("emptyMessageNoCandidates")}
            pageSize={20}
            exportable
          />
        )}
      </Card>
    </div>
  );
}
