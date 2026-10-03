import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState, Button } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { maskEmail } from "@/lib/maskPii";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { TalentPoolTable } from "./TalentPoolTable";
import {
  TALENT_POOL_PAGE_SIZE, TALENT_POOL_SOURCES, buildTalentPoolPath, candidateHref, hasActiveFilters,
  isEmptyPool, pageQuery, pageWindow, parsePage, parseSource, type TalentPoolParams,
} from "./talentPoolView";

// Mirrors HR_ROLES in services/hrms-service/src/modules/recruitment/routes.ts
// (GET /v1/hrms/talent-pool) -- kept local rather than shared, matching how
// the backend itself already re-declares this same list per route file.
const TALENT_POOL_ROLES = ["hr_admin", "hr_officer", "super_admin"];
// Revealing a past applicant's contact details (audited) is limited to these (the service enforces it again).
const TALENT_POOL_REVEAL_ROLES = ["hr_admin", "super_admin"];

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
  jobOpeningId?: string | null;
  appliedAt: string;
} & Record<string, unknown>;

type Pool = { candidates: Candidate[]; total: number; purposeNote: string | null };

// GAP-RECRUITMENT-TALENT-POOL-01 (product default, see PR VERIFY): this is the "available pool" -- the
// API deliberately returns only candidates OFF the active pipeline (rejected / withdrawn / not selected).
// The page does not request in-pipeline candidates, so there is no "Active Stages" figure to show.
async function getCandidates(params: TalentPoolParams): Promise<LoaderResult<Pool>> {
  const res = await fetchJson<unknown, Pool>(buildTalentPoolPath(params), { candidates: [], total: 0, purposeNote: null }, {
    telemetryKey: "recruitment.talent_pool",
    mapResponse: (p) => {
      const body = p as Record<string, unknown> | null;
      const d = body?.data;
      if (!Array.isArray(d)) return null;
      const total = typeof body?.total === "number" ? body.total : d.length;
      const note = body?.purposeNote;
      return { candidates: d as Candidate[], total, purposeNote: typeof note === "string" && note.trim() ? note : null };
    },
  });
  return res;
}

export default async function TalentPoolPage({
  searchParams,
}: {
  searchParams: TalentPoolParams;
}) {
  const t = await getTranslations("recruitmentTalentPool");
  const page = parsePage(searchParams.page);
  const { data: pool, source, status } = await getCandidates(searchParams);
  const { candidates, total, purposeNote } = pool;
  const canReveal = getSessionRoles().some((r) => TALENT_POOL_REVEAL_ROLES.includes(r));

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

  // Explicit allowlist: only fields the table renders, so a new API field can never leak into the client bundle.
  const rows = candidates.map((c) => ({
    id: c.id,
    applicantName: c.applicantName,
    qualification: c.qualification,
    // GAP-RECRUITMENT-TALENT-POOL-04: source is a channel, not a status -- plain text, not a pill.
    sourceDisplay: c.source === "public_portal" ? t("sourcePublicPortal") : c.source === "internal" ? t("sourceInternal") : c.source,
    stage: c.stage,
    // GAP-RECRUITMENT-TALENT-POOL-03: row -> application detail ("" when the vacancy id is missing = no link).
    href: candidateHref(c),
    // GAP-RECRUITMENT-TALENT-POOL-02 (DPDP): this server component is the only place the
    // full address exists -- mask it here so it never reaches the client bundle or a CSV.
    email: maskEmail(c.email),
    // Real data has both shapes for "no skills": a SQL NULL (skills == null)
    // and an empty array (skills == []). c.skills?.join(", ") only caught the
    // first -- an empty array produced "".join() === "" (a blank cell that
    // reads as a rendering glitch), not the placeholder every other empty
    // field in this table uses. Both shapes now render the same placeholder.
    skillsDisplay: c.skills && c.skills.length > 0 ? c.skills.join(", ") : "—",
    expDisplay: c.experienceYears != null ? t("expYearShort", { years: c.experienceYears }) : "—",
    appliedDate: new Date(c.appliedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
  }));

  const pager = pageWindow(total, page, rows.length);

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
        <StatCard icon="\ud83d\udc65" iconBg="var(--infobg)" label={t("statTotalCandidates")}   value={source === "error" ? null : total} />
        <StatCard icon="\ud83d\udca1" iconBg="var(--primary-soft)" label={t("statWithSkills")}        value={source === "error" ? null : withSkills} />
        <StatCard icon="\ud83e\udde0" iconBg="var(--warnbg)" label={t("statExperienced")} value={source === "error" ? null : experienced} />
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
          <div>
            <label htmlFor="tp-source" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 }}>{t("sourceLabel")}</label>
            <select id="tp-source" name="source" defaultValue={parseSource(searchParams.source) ?? ""} className="input" style={{ minWidth: 160 }}>
              <option value="">{t("sourceAll")}</option>
              {TALENT_POOL_SOURCES.map((v) => (
                <option key={v} value={v}>{v === "public_portal" ? t("sourcePublicPortal") : t("sourceInternal")}</option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="primary" className="btn-tall">{t("search")}</Button>
          <Link href="/hr/recruitment/talent-pool" className="btn ghost btn-tall">{t("clear")}</Link>
        </form>
      </Card>

      {/* GAP-RECRUITMENT-TALENT-POOL-02 (DPDP): purpose and retention of this applicant data. The text is configurable
          per office in recruitment settings; the default below is a conservative placeholder pending legal sign-off. */}
      <p role="note" style={{ fontSize: 12, color: "var(--ink2)", margin: "12px 0" }}>{purposeNote ?? t("purposeNoteDefault")}</p>

      <Card title={t("candidatesTitle", { count: total })}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "talent pool" })} backHref="/hr/recruitment" />
        ) : isEmptyPool(rows) && page === 1 ? (
          <EmptyState
            icon="👥"
            title={t("noCandidatesFound")}
            message={hasActiveFilters(searchParams)
              ? t("noneMatchFilter")
              : t("candidatesAppearHere")
            }
            action={<Link href="/careers" target="_blank" className="btn ghost">{t("viewPublicCareersPage")}</Link>}
          />
        ) : (
          <TalentPoolTable
            rows={rows}
            canReveal={canReveal}
            labels={{
              name: t("colName"), email: t("colEmail"), qualification: t("colQualification"), experience: t("colExperience"),
              skills: t("colSkills"), source: t("colSource"), stage: t("colStage"), applied: t("colApplied"),
              filterPlaceholder: t("filterPlaceholder"), emptyTitle: t("emptyTitleNoCandidates"), emptyMessage: t("emptyMessageNoCandidates"),
            }}
          />
        )}
        {source !== "error" && (total > TALENT_POOL_PAGE_SIZE || page > 1) && (
          <nav aria-label={t("pagerLabel")} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", flexWrap: "wrap" }}>
            {pager.hasPrev ? (
              <Link href={`/hr/recruitment/talent-pool?${pageQuery(searchParams, page - 1)}`} className="btn ghost btn-tall" rel="prev">{t("prevPage")}</Link>
            ) : null}
            <span role="status" style={{ fontSize: 13, color: "var(--mut)" }}>{t("showingRange", { from: pager.from, to: pager.to, total })}</span>
            {pager.hasNext ? (
              <Link href={`/hr/recruitment/talent-pool?${pageQuery(searchParams, page + 1)}`} className="btn ghost btn-tall" rel="next">{t("nextPage")}</Link>
            ) : null}
          </nav>
        )}
      </Card>
    </div>
  );
}
