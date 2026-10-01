import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { getTranslations } from "next-intl/server";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
// GAP-HR-SF09A-016 / GAP-HR-WORK-SUMMARY-04: GET /v1/hrms/work-summaries
// (gap-features/routes.ts READER_ROLES) already includes "employee" and
// self-scopes them server-side (resolveOwnEmployeeIdIfNonHr) -- this array
// omitted it, so a plain employee got PermissionDenied before the backend's
// own, already-correct self-service check ever ran.
const WORK_SUMMARY_ROLES = ["hr_admin", "hr_officer", "manager", "super_admin", "employee"];

const SERVER_PAGE_SIZE = 500;

type ApiRow = {
  id: string;
  employee?: string;
  employeeId?: string;
  employeeName?: string;
  department?: string;
  period?: string;
  overallGrade?: number | string | null;
  rating?: number | string | null;
  status: string;
};

type Row = {
  id: string;
  employee: string;
  employeeId: string;
  department: string;
  period: string;
  overallGrade: string;
  rating: string;
  status: string;
} & Record<string, unknown>;

function mapRows(apiItems: ApiRow[]): Row[] {
  return apiItems.map((s) => ({
    id: s.id,
    employee: s.employee ?? s.employeeName ?? "—",
    // GAP-HR-WORK-SUMMARY-06: the "Employees" stat used to count distinct
    // *display names*, silently merging two different people who happen to
    // share a name. The backend now selects a real employeeId; falling
    // back to the row id only protects against an old/uncached response
    // shape, not an expected case going forward.
    employeeId: s.employeeId ?? s.id,
    department: s.department ?? "—",
    // GAP-HR-WORK-SUMMARY-06: period used to print raw ("2025-26").
    period: s.period ? `FY ${s.period}` : "—",
    // GAP-HR-WORK-SUMMARY-01: "tasks" (`${tasksCompleted} / ${totalTasks}`)
    // was fabricated -- the backend mapped an APAR overall_grade onto it
    // and hard-coded totalTasks to a literal 10, so an appraisal grade of 8
    // showed as "8 / 10 tasks completed". No task data exists in this
    // source, so this now shows the real overall_grade instead of
    // inventing a task count.
    overallGrade: s.overallGrade != null ? Number(s.overallGrade).toFixed(1) : "—",
    // GAP-HR-WORK-SUMMARY-02: the backend used to COALESCE(rating, 0),
    // so this null-check was already correct but could never actually be
    // reached -- every unrated appraisal arrived as a genuine-looking
    // "0.0 / 5" instead of null. Fixed at the source (no COALESCE); this
    // line itself is unchanged, it just now does something.
    rating: s.rating != null ? `${Number(s.rating).toFixed(1)} / 5` : "—",
    status: s.status,
  }));
}

// Kept as raw ApiRow[] here (mapRows() is applied in the page component
// itself, not inside mapResponse below) so this loader stays consistent
// with the other 3 pages in this lane (locations' withDerivedHierarchy,
// pay-matrix's formatMoney/designations join, social-feed's badge/date
// formatting): the loader's job is fetching + shaping the wire response,
// not display formatting.
type WorkSummaryApiPage = { rows: ApiRow[]; total: number; offset: number };

async function getData(offset: number): Promise<LoaderResult<WorkSummaryApiPage>> {
  return fetchJson<unknown, WorkSummaryApiPage>(`/api/v1/hrms/work-summaries?offset=${offset}`, { rows: [], total: 0, offset }, {
    telemetryKey: "hr.work-summaries",
    mapResponse: (p) => {
      const body = p as { data?: ApiRow[]; total?: number; offset?: number };
      if (!Array.isArray(body?.data)) return null;
      return { rows: body.data, total: body.total ?? body.data.length, offset: body.offset ?? offset };
    },
  });
}

export default async function WorkSummaryPage({
  searchParams,
}: {
  searchParams?: { offset?: string };
}) {
  const t = await getTranslations("workSummary");
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => WORK_SUMMARY_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="work summaries" requiredRoles={WORK_SUMMARY_ROLES} />;
  }
  // GAP-HR-WORK-SUMMARY-03: a manager is self-scoped by the backend today
  // (resolveOwnEmployeeIdIfNonHr treats manager the same as employee here,
  // deliberately -- this module has no "manager sees direct reports"
  // precedent) -- but the page's copy implied a team view regardless. This
  // is an interim, honesty-only fix: whether managers should eventually get
  // a real direct-reports view (needing a new backend scope) is a genuine
  // product decision, not covered by an explicit default in the HR gap
  // decision packet's ~30 flagged calls -- left open, flagged for a human
  // call given the IDOR-adjacent risk the catalog itself notes. This just
  // makes today's actual (self-scoped) behavior honest in the UI.
  const isHr = roles.some((r) => HR_ROLES.includes(r));

  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);
  const { data: page, source, status, errorMessage } = await getData(offset);
  const errored = source === "error";
  const items = mapRows(page.rows);
  const total = page.total;

  const reviewed = items.filter((i) => ["approved", "accepted", "finalised"].includes(i.status)).length;
  const pending = items.filter((i) => ["pending", "submitted"].includes(i.status)).length;
  const employees = new Set(items.map((i) => i.employeeId)).size;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "period", label: t("colPeriod") },
    { key: "overallGrade", label: t("colOverallGrade") },
    { key: "rating", label: t("colRating") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = offset + items.length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={isHr ? t("subtitle") : t("subtitleSelf")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      {!errored ? <DataSourceBadge source={source} /> : null}
      <StatGrid>
        <StatCard icon="📝" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : total} />
        <StatCard icon="👤" iconBg="var(--bg, #f5f5f5)" label={t("statEmployees")} value={errored ? null : employees} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statReviewed")} value={errored ? null : reviewed} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <LoadErrorState result={{ status, errorMessage }} area="work summary" backHref="/hr" />
        ) : (
          <>
            {/* GAP-HR-WORK-SUMMARY-05: the backend used to LIMIT 500 with no
                total count and no way to reach the rest -- a silent
                truncation for any tenant with more than 500 appraisal
                records. Now shows an honest range + a total, and pages via
                offset when there's more than one server page. */}
            {total > items.length || offset > 0 ? (
              <p style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 12px" }}>
                {t("showingRange", { from: showingFrom, to: showingTo, total })}
              </p>
            ) : null}
            <DataTable<Row>
              columns={columns}
              rows={items}
              sortable
              filterable
              filterPlaceholder={t("filterPlaceholder")}
              pageSize={15}
              emptyIcon="📝"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
            {total > SERVER_PAGE_SIZE ? (
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                {offset > 0 ? (
                  <Link href={`/hr/work-summary?offset=${Math.max(0, offset - SERVER_PAGE_SIZE)}`} className="btn ghost">
                    {t("prevPage")}
                  </Link>
                ) : null}
                {offset + SERVER_PAGE_SIZE < total ? (
                  <Link href={`/hr/work-summary?offset=${offset + SERVER_PAGE_SIZE}`} className="btn ghost">
                    {t("nextPage")}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
