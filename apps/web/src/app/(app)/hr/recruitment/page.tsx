import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { Globe, Users } from "lucide-react";
import { buildHubCards, isNoOpenings, normaliseRosterStatus, type HubStats } from "./recruitmentHomeView";

// Both "New Vacancy" and "Post First Job" used to render for every viewer
// regardless of role, even though the destination page
// (/hr/recruitment/new) gates on RECRUITMENT_ADMIN_ROLES (its own POST
// /v1/hrms/job-openings guard) and 403s everyone else. Mirrors that list
// exactly, checked here before rendering either button. GET stays broader
// (that page's own comment: ALL_ROLES additionally includes "manager"), so
// this page itself stays visible to more roles than may actually create a
// vacancy -- only the two create affordances are restricted here.
const RECRUITMENT_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type DashboardStats = HubStats;

type Opening = {
  id: string;
  jobTitle: string;
  department: string;
  vacancies: number;
  status: string;
  applicationsReceived: number;
  postedDate: string;
  applicationDeadline?: string;
  vacancyType?: string;
  /** GAP-RECRUITMENT-HOME-04: live on /careers. */
  isPublished?: boolean;
  /** GAP-RECRUITMENT-HOME-05: advertisement / notification number, null until assigned. */
  advertisementNo?: string | null;
  /** GAP-RECRUITMENT-HOME-05: "none" | "draft" | "approved". */
  rosterStatus?: string;
  /** GAP-RECRUITMENT-HOME-05: application fee in paise, as a string. */
  feesMinor?: string | null;
} & Record<string, unknown>;

type OpeningRow = Opening & { visibility: string; rosterDisplay: string; advertisementDisplay: string };

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
  const [{ data: stats, source: statsSource, status: statsStatus }, { data: openings, source: openingSource }] = await Promise.all([getDashboard(), getOpenings()]);
  // GAP-RECRUITMENT-HOME-02: a 403 on the HR-only dashboard endpoint is a permanent role restriction
  // (a manager still gets a real, department-scoped openings list), not a transient failure -- the cards
  // are derived from that list instead of showing zeros next to a populated table, and no "couldn't be
  // loaded" chip invites a pointless retry. Any other stats failure keeps the chip and shows "—".
  const { mode: statsMode, cards } = buildHubCards({ statsSource, statsStatus, stats, openings, openingsSource: openingSource });
  // Either fetch failing is worth telling the clerk about -- the stat cards
  // below would otherwise show a silent, indistinguishable-from-real all-zero
  // dashboard when only /recruitment/dashboard fails.
  const pageSource = openingSource === "error" || statsMode === "unavailable" ? "error" : "api";
  // The badge's default copy ("Couldn't load -- showing nothing") is only
  // true when the openings list itself -- this page's actual content --
  // failed to load (UX-002: never say "showing nothing" when something IS showing).
  const badgeMessage =
    openingSource === "error"
      ? undefined
      : statsMode === "unavailable"
        ? t("statsPartialError")
        : undefined;

  // GAP-RECRUITMENT-HOME-04/05: published + roster state per row, as plain data (server-safe).
  const rows: OpeningRow[] = openings.map((o) => ({
    ...o,
    visibility: o.isPublished === true ? "published" : "unpublished",
    rosterDisplay: t(`roster_${normaliseRosterStatus(o.rosterStatus)}`),
    advertisementDisplay: o.advertisementNo ? o.advertisementNo : "—",
  }));

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
            {canCreate && <Link href="/hr/recruitment/requisitions" className="btn ghost">{t("requisitions")}</Link>}
            {canCreate && <Link href="/hr/recruitment/new" className="btn primary">{t("newVacancy")}</Link>}
          </>
        }
      />

      <DataSourceBadge source={pageSource} message={badgeMessage} />
      {statsMode === "derived" && (
        <p role="note" style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 8px" }}>{t("statsDerivedNote", { count: openings.length })}</p>
      )}
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotalVacancies")} value={cards.total} />
        <StatCard icon="🟢" iconBg="var(--goodbg)" label={t("statOpenNow")} value={cards.open} />
        <StatCard icon="📨" iconBg="var(--line2)" label={t("statApplicationsReceived")} value={cards.applications} />
        <StatCard icon="🌐" iconBg="var(--infobg)" label={t("statPublishedPublic")} value={cards.published} />
        <StatCard icon="🎓" iconBg="var(--primary-soft)" label={t("statInternshipsApprenticeships")} value={cards.internships} />
      </StatGrid>

      <Card title={t("allVacanciesTitle")}>
        {openingSource === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "job openings" })} />
        ) : isNoOpenings(openings) ? (
          <EmptyState
            title={t("emptyTitle")}
            message={t("emptyMessage")}
            action={canCreate ? <Link href="/hr/recruitment/new" className="btn primary">{t("postFirstJob")}</Link> : undefined}
          />
        ) : (
          <DataTable<OpeningRow>
            columns={[
              { key: "jobTitle", label: t("colPosition") },
              { key: "advertisementDisplay", label: t("colAdvertisementNo") },
              { key: "department", label: t("colDepartment") },
              { key: "vacancies", label: t("colPosts"), align: "right" },
              { key: "applicationsReceived", label: t("colApplications"), align: "right" },
              // GAP-RECRUITMENT-HOME-01: shared Indian date format; sorts/exports on the raw ISO value.
              { key: "postedDate", label: t("colPosted"), cellType: "date" },
              { key: "status", label: t("colStatus"), cellType: "status" },
              { key: "visibility", label: t("colPublished"), cellType: "status" },
              { key: "rosterDisplay", label: t("colRoster") },
              { key: "feesMinor", label: t("colFee"), cellType: "amount", align: "right" },
            ]}
            rows={rows}
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
          <Globe size={16} aria-hidden="true" />
          {t("viewPublicCareersPage")}
        </Link>
        <Link href="/hr/recruitment/talent-pool" className="btn ghost">
          <Users size={16} aria-hidden="true" />
          {t("browseTalentPool")}
        </Link>
      </div>
    </div>
  );
}
