import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";

// HRMS peripheral medium findings, item 5: both "New Vacancy" and "Post
// First Job" rendered for every viewer regardless of role, even though the
// destination page (/hr/recruitment/new) gates on RECRUITMENT_ADMIN_ROLES
// and 403s everyone else. Aligned to the dominant pattern (departments,
// designations, training, locations, pensioners): same role list as
// recruitment/new/page.tsx, checked before rendering either button.
const RECRUITMENT_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type DashboardStats = {
  totalOpenings: number;
  openVacancies: number;
  publishedVacancies: number;
  internshipsApprenticeships: number;
  applicationsInternal: number;
  applicationsPublic: number;
};

type Opening = {
  id: string;
  jobTitle: string;
  department: string;
  vacancies: number;
  status: string;
  applicationsReceived: number;
  postedDate: string;
  applicationDeadline?: string;
} & Record<string, unknown>;

async function getDashboard(): Promise<LoaderResult<DashboardStats>> {
  const res = await fetchJson<unknown, DashboardStats>("/api/v1/hrms/recruitment/dashboard", {
    totalOpenings: 0, openVacancies: 0, publishedVacancies: 0,
    internshipsApprenticeships: 0, applicationsInternal: 0, applicationsPublic: 0,
  }, { telemetryKey: "recruitment.dashboard", mapResponse: (p) => p as DashboardStats });
  return res;
}

async function getOpenings(): Promise<LoaderResult<Opening[]>> {
  const res = await fetchJson<unknown, Opening[]>("/api/v1/hrms/job-openings?limit=100", [], {
    telemetryKey: "recruitment.openings",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as Record<string, unknown>)?.data;
      return Array.isArray(arr) ? arr as Opening[] : null;
    },
  });
  return res;
}

export default async function RecruitmentPage() {
  const t = await getTranslations("recruitment");
  const roles = getSessionRoles();
  const canCreate = roles.some((r) => RECRUITMENT_ADMIN_ROLES.includes(r));
  const [{ data: stats, source: statsSource }, { data: openings, source: openingSource }] = await Promise.all([getDashboard(), getOpenings()]);
  const totalApps = stats.applicationsInternal + stats.applicationsPublic;
  // Either fetch failing is worth telling the clerk about -- the stat cards
  // below would otherwise show a silent, indistinguishable-from-real all-zero
  // dashboard when only /recruitment/dashboard fails (openings table has its
  // own badge, but stats previously had none at all).
  const pageSource = statsSource === "error" || openingSource === "error" ? "error" : "api";
  // The badge's default copy ("Couldn't load -- showing nothing") is only
  // true when the openings list itself -- this page's actual content --
  // failed to load. A manager role (or anyone else correctly denied the
  // HR-only /recruitment/dashboard stats endpoint) still gets a full,
  // real openings table below; telling them "showing nothing" while a
  // real table of vacancies renders directly underneath is false and was
  // read, in live testing, as the whole page being broken. Same principle
  // the badge's own doc comment already applies to the cached-data case
  // (UX-002: never say "showing nothing" when something IS showing) --
  // just not yet applied to this partial-failure case.
  const badgeMessage =
    openingSource === "error"
      ? undefined
      : statsSource === "error"
        ? "Some figures on this page couldn't be loaded."
        : undefined;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        help="hr"
        actions={
          <>
            <Link href="/hr/recruitment/talent-pool" className="btn ghost">{t("talentPool")}</Link>
            {canCreate && <Link href="/hr/recruitment/new" className="btn primary">{t("newVacancy")}</Link>}
          </>
        }
      />

      <DataSourceBadge source={pageSource} message={badgeMessage} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotalVacancies")} value={stats.totalOpenings} />
        <StatCard icon="🟢" iconBg="var(--goodbg)" label={t("statOpenNow")} value={stats.openVacancies} />
        <StatCard icon="📨" iconBg="var(--line2)" label={t("statApplicationsReceived")} value={totalApps} />
        <StatCard icon="🌐" iconBg="var(--infobg)" label={t("statPublishedPublic")} value={stats.publishedVacancies} />
      </StatGrid>

      <Card title={t("allVacanciesTitle")}>
        {openingSource === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "job openings" })} />
        ) : openings.length === 0 ? (
          <EmptyState
            icon="💼"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
            action={canCreate ? <Link href="/hr/recruitment/new" className="btn primary">{t("postFirstJob")}</Link> : undefined}
          />
        ) : (
          <DataTable<Opening>
            columns={[
              { key: "jobTitle", label: t("colPosition") },
              { key: "department", label: t("colDepartment") },
              { key: "vacancies", label: t("colPosts"), align: "right" },
              { key: "applicationsReceived", label: t("colApplications"), align: "right" },
              { key: "postedDate", label: t("colPosted") },
              { key: "status", label: t("colStatus"), cellType: "status" },
            ]}
            rows={openings}
            rowLinkKey="id"
            rowLinkPrefix="/hr/recruitment/"
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📋"
            emptyTitle={t("noVacanciesMatch")}
            emptyMessage={t("tryDifferentSearch")}
          />
        )}
      </Card>

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/careers" target="_blank" className="btn ghost">
          {t("viewPublicCareersPage")}
        </Link>
        <Link href="/hr/recruitment/talent-pool" className="btn ghost">
          {t("browseTalentPool")}
        </Link>
      </div>
    </div>
  );
}
