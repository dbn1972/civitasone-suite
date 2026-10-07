/**
 * APAR list page — Sprint 14 / Lifecycle Phase 2
 * Flow card view (APARFlowList) replaces the plain DataTable.
 * Each card shows the 5-group DoPT/SPARROW pipeline with active stage
 * highlighted (GAP-HR-APAR-01/05 — see @/lib/apar/stages and
 * APARFlowCard.tsx for the full rationale).
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { APARFlowList, type AparRecord } from "./_components/APARFlowCard";
import { APARCycleProgress } from "./_components/APARCycleProgress";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { APAR_STATUSES, stageLabelKey } from "@/lib/apar/stages";

// Mirrors the backend's ACTOR_ROLES (apar/routes.ts). "employee"/"manager"
// are included here too -- the API scopes their view server-side (own
// record / direct reports' records) rather than denying them outright, so
// this gate only needs to keep roles with NO legitimate APAR access (e.g. a
// citizen-only session) off the page. Defense in depth alongside the API's
// own auth checks, matching the pattern on the RTI page.
const APAR_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager", "employee"];

// GAP-HR-SF09A-010 / GAP-HR-APAR-04: mirrors the backend's OWN, narrower
// HR_ROLES (apar/routes.ts) used specifically for POST /v1/hrms/apar and
// POST /v1/hrms/apar/:id/finalise -- unlike the rest of the APAR flow
// (self-appraisal/reporting/reviewing/accept/representation, all
// ACTOR_ROLES), initiating and finalising an APAR is HR-only. Kept in sync
// with the identical const in ./new/page.tsx (that page's own server-side
// gate) -- see this app's role-matrix contract test
// (scripts/contract/hr-role-matrix.mjs) for the two routes this covers.
const APAR_INITIATE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

interface AparListCounts {
  selfPending: number;
  inReview: number;
  awaitingClosure: number;
  finalised: number;
}

interface AparListData {
  records: AparRecord[];
  total: number;
  hasMore: boolean;
  counts: AparListCounts;
}

const EMPTY_COUNTS: AparListCounts = { selfPending: 0, inReview: 0, awaitingClosure: 0, finalised: 0 };

// GAP-HR-APAR-06: forwards the page's own ?status=/?period= filters to the
// backend (repo.listAppraisals' new optional exact-match filters) instead
// of always fetching an unfiltered, silently-capped-at-100 list.
async function getApars(filters: { status?: string; period?: string }) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.period) params.set("period", filters.period);
  const qs = params.toString();
  return fetchJson<unknown, AparListData | null>(`/api/v1/hrms/apar${qs ? `?${qs}` : ""}`, null, {
    telemetryKey: "apar.list",
    mapResponse: (p) => {
      const body = p as Record<string, unknown>;
      const arr = body?.data;
      if (!Array.isArray(arr)) return null;
      const rawCounts = body.counts as Partial<AparListCounts> | undefined;
      return {
        records: arr as AparRecord[],
        total: typeof body.total === "number" ? body.total : arr.length,
        hasMore: Boolean(body.hasMore),
        counts: {
          selfPending: rawCounts?.selfPending ?? 0,
          inReview: rawCounts?.inReview ?? 0,
          awaitingClosure: rawCounts?.awaitingClosure ?? 0,
          finalised: rawCounts?.finalised ?? 0,
        },
      };
    },
  });
}

export default async function AparListPage({
  searchParams,
}: {
  searchParams: { status?: string; period?: string };
}) {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => APAR_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="APAR appraisals" requiredRoles={APAR_ROLES} />;
  }
  // GAP-HR-SF09A-010 / GAP-HR-APAR-04: manager/employee can view this list
  // (APAR_ROLES above) but POST /v1/hrms/apar is HR-only -- don't offer a
  // button that always 403s on arrival at /hr/apar/new (also gated there,
  // see that page).
  const canInitiate = roles.some((r) => APAR_INITIATE_ROLES.includes(r));

  const t = await getTranslations("apar");
  // Reuses the stage-label strings already defined for the detail page
  // (aparDetail.stageSelfPending, etc. — see @/lib/apar/stages) for the
  // status filter's option text, rather than declaring a second copy.
  const tStage = await getTranslations("aparDetail");
  const statusFilter = typeof searchParams.status === "string" ? searchParams.status : undefined;
  const periodFilter = typeof searchParams.period === "string" ? searchParams.period : undefined;
  const result = await getApars({ status: statusFilter, period: periodFilter });
  const errored = result.source === "error";
  const { records: apars, total, hasMore, counts } = result.data ?? {
    records: [], total: 0, hasMore: false, counts: EMPTY_COUNTS,
  };

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        help="hr"
        actions={
          canInitiate ? (
            <Link href="/hr/apar/new" className="btn primary">
              {t("initiateBtn")}
            </Link>
          ) : undefined
        }
      />
      <DataSourceBadge source={result.source} />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")}           value={errored ? null : total} />
        <StatCard icon="✍️" iconBg="var(--warnbg, #fffbe6)" label={t("statSelfAppraisal")}    value={errored ? null : counts.selfPending} />
        <StatCard icon="🔍" iconBg="var(--infobg, #e6f0ff)" label={t("statUnderReview")}      value={errored ? null : counts.inReview} />
        <StatCard icon="📨" iconBg="var(--warnbg, #fff7e6)" label={t("statAwaitingClosure")}  value={errored ? null : counts.awaitingClosure} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statFinalised")}        value={errored ? null : counts.finalised} />
      </StatGrid>

      {/* GAP-HR-APPRAISALS-02: a single at-a-glance "how far along is this
          cycle" read, distinct from the five individual stat tiles above.
          Hidden on error (no 0%) and when there is nothing to show a
          percentage of (total === 0) -- see APARCycleProgress's own doc
          comment for why this takes the already server-computed
          total/counts.finalised rather than deriving from `apars` (which is
          only the current, possibly-truncated batch -- GAP-HR-APAR-06).
          Unfiltered view only: the backend applies ?status=/?period= to
          `total` but not to `counts`, so a filtered view would mix two
          different sets (e.g. "25 of 3 finalised"). */}
      {!errored && !statusFilter && !periodFilter && <APARCycleProgress total={total} finalised={counts.finalised} />}

      {!errored && (
        <form method="get" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", margin: "4px 0 16px" }}>
          <div>
            <label htmlFor="apar-filter-status" style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>
              {t("filterStatusLabel")}
            </label>
            <select id="apar-filter-status" name="status" defaultValue={statusFilter ?? ""}>
              <option value="">{t("filterAllStatuses")}</option>
              {APAR_STATUSES.map((s) => {
                const labelKey = stageLabelKey(s);
                return (
                  <option key={s} value={s}>{labelKey ? tStage(labelKey) : s}</option>
                );
              })}
            </select>
          </div>
          <div>
            <label htmlFor="apar-filter-period" style={{ fontSize: 13, color: "var(--mut)", display: "block", marginBottom: 4 }}>
              {t("filterPeriodLabel")}
            </label>
            <input
              id="apar-filter-period"
              name="period"
              defaultValue={periodFilter ?? ""}
              placeholder={t("filterPeriodPlaceholder")}
              maxLength={16}
            />
          </div>
          <button type="submit" className="btn primary">{t("filterApplyBtn")}</button>
          {(statusFilter || periodFilter) && (
            <Link href="/hr/apar" className="btn ghost">{t("filterClearBtn")}</Link>
          )}
        </form>
      )}

      <Card title={t("flowCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "apar" })} backHref="/hr" />
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <APARFlowList records={apars} />
            {hasMore && (
              <p style={{ marginTop: 12, fontSize: 13, color: "var(--mut)" }}>
                {t("showingOfTotal", { shown: apars.length, total })}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
