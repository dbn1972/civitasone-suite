import Link from "next/link";
import { PageHeader, StatGrid, StatCard, EmptyState, RefreshErrorState, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { JoineeCard, type JoineeCardData } from "./_components/JoineeCard";
import { getTranslations } from "next-intl/server";

// Mirrors HR_ROLES in services/hrms-service/src/modules/lifecycle/onboarding-routes.ts
// (GET /v1/hrms/onboarding) -- kept local rather than shared, matching how
// the backend itself already re-declares this same list per route file.
const ONBOARDING_ROLES = ["hr_admin", "hr_officer", "super_admin"];

const PAGE_SIZE = 20;

// GAP-HR-ONBOARDING-05: the backend's default (no `status` param) is
// "active" (everything except completed) -- these are the only other
// values it accepts; "all" is spelled out explicitly rather than merely
// omitting the param, so a filter link's href is self-describing.
type StatusFilter = "active" | "all" | "in_progress" | "overdue" | "completed";
const STATUS_FILTERS: StatusFilter[] = ["active", "all", "in_progress", "overdue", "completed"];

function isStatusFilter(v: string | undefined): v is StatusFilter {
  return !!v && (STATUS_FILTERS as string[]).includes(v);
}

type Row = {
  id: string;
  employee: string;
  department: string | null;
  joiningDate: string | null;
  stepsCompleted: string | number;
  totalSteps: string | number;
  overdue: number;
  progress: string | number;
  status: string;
} & Record<string, unknown>;

type OnboardingCounts = { total: number; inProgress: number; overdue: number; completed: number };
type OnboardingMeta = { total: number; limit: number; offset: number; counts: OnboardingCounts };

const EMPTY_COUNTS: OnboardingCounts = { total: 0, inProgress: 0, overdue: 0, completed: 0 };
const EMPTY_META: OnboardingMeta = { total: 0, limit: PAGE_SIZE, offset: 0, counts: EMPTY_COUNTS };

type OnboardingListResult = { rows: Row[]; meta: OnboardingMeta };

function onboardingHref(status: StatusFilter, page: number): string {
  const qs: string[] = [];
  if (status !== "active") qs.push("status=" + encodeURIComponent(status));
  if (page > 0) qs.push("page=" + page);
  return "/hr/onboarding" + (qs.length ? "?" + qs.join("&") : "");
}

async function getData(status: StatusFilter, offset: number): Promise<LoaderResult<OnboardingListResult>> {
  const qs = new URLSearchParams({ status, limit: String(PAGE_SIZE), offset: String(offset) });
  return fetchJson<unknown, OnboardingListResult>(`/api/v1/hrms/onboarding?${qs.toString()}`, { rows: [], meta: EMPTY_META }, {
    telemetryKey: "hr.onboarding",
    mapResponse: (p) => {
      const body = p as { data?: Row[]; meta?: OnboardingMeta } | Row[] | null;
      const rows = Array.isArray(body) ? body : (body?.data ?? null);
      if (!Array.isArray(rows)) return null;
      const meta = (!Array.isArray(body) && body?.meta) ? body.meta : { ...EMPTY_META, total: rows.length };
      return { rows, meta };
    },
  });
}

// GAP-HR-ONBOARDING-01: the API returns stepsCompleted as the string
// "<completed>/<total>" (e.g. "2/6"), not a number -- Number("2/6") is NaN.
// Parse the numerator instead of coercing the whole string.
function parseStepsCompleted(value: string | number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const numerator = value.split("/")[0];
  const n = Number(numerator);
  return Number.isFinite(n) ? n : 0;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Record<string, string>;
}) {
  const t = await getTranslations("onboarding");
  const statusFilter: StatusFilter = isStatusFilter(searchParams?.status) ? (searchParams!.status as StatusFilter) : "active";
  const page = Math.max(0, parseInt(searchParams?.page ?? "0", 10) || 0);
  const { data, source, status } = await getData(statusFilter, page * PAGE_SIZE);
  const { rows: items, meta } = data;

  // A 403 here is a real, permanent role restriction (this is a tenant-wide
  // onboarding summary across every new joinee, deliberately HR-only -- see
  // HR_ROLES in onboarding-routes.ts), not a transient failure. The normal
  // "Couldn't load -- try again" error state is misleading for it: retrying
  // never succeeds, and it reads as this page being broken rather than as a
  // role the viewer correctly doesn't have. Skip the stat tiles/cards
  // entirely (none of it is meaningful with zero access) and say plainly
  // what's actually true.
  if (status === 403) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          back="/hr" backLabel="Back to HR"
        />
        <PermissionDenied module="the onboarding tracker" requiredRoles={ONBOARDING_ROLES} />
      </div>
    );
  }

  const cardData: JoineeCardData[] = items.map((row) => ({
    id: row.id,
    employee: row.employee,
    // GAP-HR-ONBOARDING-04: the API now sends null (not a raw department
    // uuid) when the department can't be resolved -- map that to the same
    // "—" placeholder used everywhere else on this card, here rather than
    // inside JoineeCard so the component's contract stays "already display
    // text", matching how joiningDate is handled by formatIndianDate.
    department: row.department ?? "—",
    joiningDate: row.joiningDate,
    stepsCompleted: parseStepsCompleted(row.stepsCompleted),
    totalSteps: parseStepsCompleted(row.totalSteps),
    overdue: Number(row.overdue),
    progress: Number(String(row.progress).replace("%", "")),
    status: row.status,
  }));

  // GAP-HR-ONBOARDING-06: the API only ever produces completed|overdue|
  // in_progress (onboarding-routes.ts) -- "pending" here was dead code that
  // could never match anything and quietly implied a status this tracker
  // has never been able to show.
  const order: Record<string, number> = { overdue: 0, in_progress: 1, completed: 2 };
  const sorted = [...cardData].sort((a, b) => {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue;
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  const FILTER_TABS: { key: StatusFilter; label: string }[] = [
    { key: "active", label: t("tabActive") },
    { key: "overdue", label: t("tabOverdue", { count: meta.counts.overdue }) },
    { key: "in_progress", label: t("tabInProgress", { count: meta.counts.inProgress }) },
    { key: "completed", label: t("tabCompleted", { count: meta.counts.completed }) },
    { key: "all", label: t("tabAll", { count: meta.counts.total }) },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={
          <Link href="/hr/employees/new" className="btn primary" aria-label="Add new joinee">
            {t("addJoinee")}
          </Link>
        }
      />

      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="👋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={meta.counts.total} />
        <StatCard icon="🔄" iconBg="var(--warnbg, #fffbe6)" label={t("statInProgress")} value={meta.counts.inProgress} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statCompleted")} value={meta.counts.completed} />
        {/* GAP-HR-ONBOARDING-05: this counts JOINEES who have at least one
            overdue task, not the number of overdue tasks -- the label used
            to read "Overdue Tasks", which a two-joinee/five-overdue-tasks
            tenant would misread as "5". */}
        <StatCard icon="⚠️" iconBg="var(--badbg, #fff1f0)" label={t("statOverdue")} value={meta.counts.overdue} />
      </StatGrid>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, marginBottom: 4 }} role="tablist" aria-label={t("filterAriaLabel")}>
        {FILTER_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={onboardingHref(tab.key, 0)}
            role="tab"
            aria-selected={statusFilter === tab.key}
            className={statusFilter === tab.key ? "chip chip-active" : "chip"}
            style={{
              fontSize: 13, padding: "5px 12px", borderRadius: 20,
              background: statusFilter === tab.key ? "var(--primary)" : "var(--bg2)",
              color: statusFilter === tab.key ? "var(--panel, #fff)" : "var(--ink)",
              textDecoration: "none", fontWeight: statusFilter === tab.key ? 600 : 400,
              border: "1px solid var(--line)",
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* ── Joinee card grid (manager view) ─────────────────────────────────── */}
      {source === "error" ? (
        <Card style={{ marginTop: 20, padding: 32 }}>
          <RefreshErrorState error={toHumanError("load", { area: "onboarding tracker" })} backHref="/hr" />
        </Card>
      ) : items.length === 0 ? (
        <Card style={{ marginTop: 20, padding: 32 }}>
          <EmptyState
            icon="👋"
            title={statusFilter === "active" && meta.counts.total === 0 ? t("emptyTitle") : t("emptyFilteredTitle")}
            message={statusFilter === "active" && meta.counts.total === 0 ? t("emptyMessage") : t("emptyFilteredMessage")}
            action={
              meta.counts.total === 0 ? (
                <Link
                  href="/hr/employees/new"
                  className="btn primary"
                  style={{ marginTop: 12, display: "inline-block" }}
                  aria-label="Add new joinee to start onboarding"
                >
                  Add New Joinee
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {meta.counts.overdue > 0 && (
            <div
              role="alert"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "var(--warnbg, #fffbeb)",
                border: "1px solid var(--warnbd, #fde68a)",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--warn, #92400e)",
                fontWeight: 500,
                marginTop: 12,
                marginBottom: 4,
              }}
            >
              <span aria-hidden style={{ fontSize: 16 }}>⚠️</span>
              <span>
                <strong>{meta.counts.overdue}</strong> onboarding{meta.counts.overdue > 1 ? "s" : ""} have overdue tasks — highlighted in amber below.
              </span>
            </div>
          )}

          <section aria-label="Joinee onboarding cards">
            <div
              className="onboarding-card-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 14,
                marginTop: 16,
              }}
            >
              {sorted.map((card) => (
                <JoineeCard key={card.id} {...card} />
              ))}
            </div>
          </section>

          {meta.total > PAGE_SIZE && (
            <nav aria-label={t("paginationAriaLabel")} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, fontSize: 13 }}>
              {page > 0 && (
                <Link href={onboardingHref(statusFilter, page - 1)} className="btn">
                  {"←"} {t("prevLabel")}
                </Link>
              )}
              <span style={{ color: "var(--ink2)" }}>
                {t("showingRange", {
                  from: page * PAGE_SIZE + 1,
                  to: Math.min((page + 1) * PAGE_SIZE, meta.total),
                  total: meta.total,
                })}
              </span>
              {(page + 1) * PAGE_SIZE < meta.total && (
                <Link href={onboardingHref(statusFilter, page + 1)} className="btn">
                  {t("nextLabel")} {"→"}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
