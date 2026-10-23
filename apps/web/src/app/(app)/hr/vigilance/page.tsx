import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { HR_STAFF_ROLES } from "@/lib/auth/workRoles";
import { humanizeStatus } from "@/lib/formatters";
import { VigilanceTable, type VigilanceRow } from "./VigilanceTable";

/**
 * Mirrors services/hrms-service/src/modules/gap-features/routes.ts's
 * HR_ROLES guard on GET /v1/hrms/vigilance exactly.
 */
const VIGILANCE_ROLES = HR_STAFF_ROLES;

// GAP-HR-VIGILANCE-04: server batch size per fetch -- see the matching
// constant/comment on hr/disciplinary/page.tsx.
const PAGE_BATCH = 200;

/**
 * The statuses the register can be filtered by -- every case status the
 * backend's `status` param accepts (state-machine.ts), minus "dropped": a
 * dropped case is hidden from this register by default (GAP-HR-VIGILANCE-01),
 * so offering it as a filter would only ever show an empty list. Order follows
 * the proceedings' own flow.
 */
const VIGILANCE_FILTER_STATUSES = [
  "opened",
  "charge_memo_issued",
  "inquiry_appointed",
  "finding_recorded",
  "pending_approval",
  "penalty_imposed",
  "appeal_filed",
  "appeal_decided",
  "closed",
] as const;

type RawRow = {
  id: string;
  caseNo: string | null;
  employee: string;
  department: string;
  // GAP-HR-VIGILANCE-01 (PII/DPDP): the page requests the list with
  // maskCharges=true, so the backend sends NO charge text at all
  // (charges_summary is null) -- only whether there is any to reveal. The text
  // is read through the audited, reason-bearing reveal route (VigilanceTable).
  // Dropped (exonerated/discontinued) cases are omitted entirely by default;
  // the full allegation stays on the case detail page (which is read-audited).
  charges_summary: string | null;
  hasCharges?: boolean;
  filedDate: string;
  inquiryOfficer: string;
  nextHearing: string;
  status: string;
} & Record<string, unknown>;

type Stats = {
  chargeMemoStage: number; underInquiry: number; penaltyAndAppeal: number; closed: number; dropped: number; total: number;
};
type ListPage = { items: RawRow[]; total: number; hasMore: boolean; stats: Stats };

const EMPTY_STATS: Stats = { chargeMemoStage: 0, underInquiry: 0, penaltyAndAppeal: 0, closed: 0, dropped: 0, total: 0 };

type Filters = { status?: string; q?: string };

async function getData(offset: number, filters: Filters): Promise<LoaderResult<ListPage>> {
  // GAP-HR-VIGILANCE-04: status / q are applied by the backend over every case
  // in the tenant (not just the loaded batch). GAP-HR-VIGILANCE-01:
  // maskCharges=true keeps the charge text out of the response.
  const params = new URLSearchParams({ limit: String(PAGE_BATCH), offset: String(offset), maskCharges: "true" });
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  return fetchJson<unknown, ListPage>(
    `/api/v1/hrms/vigilance?${params.toString()}`,
    { items: [], total: 0, hasMore: false, stats: EMPTY_STATS },
    {
      telemetryKey: "hr.vigilance",
      mapResponse: (p) => {
        const body = p as { data?: RawRow[]; total?: number; hasMore?: boolean; stats?: Stats } | null;
        if (!body || !Array.isArray(body.data)) return null;
        return {
          items: body.data,
          total: body.total ?? body.data.length,
          hasMore: body.hasMore ?? false,
          stats: { ...EMPTY_STATS, ...(body.stats ?? {}) },
        };
      },
    },
  );
}

export default async function VigilancePage(
  props: {
    searchParams?: Promise<{ page?: string; status?: string; q?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => VIGILANCE_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="vigilance cases" requiredRoles={VIGILANCE_ROLES} />;
  }

  const t = await getTranslations("vigilance");
  // GAP-HR-VIGILANCE-04 (CAP): same unpaginated-LIMIT-200 bug as the
  // disciplinary list; page steps through PAGE_BATCH-sized server batches.
  const page = Math.max(1, Math.trunc(Number(searchParams?.page)) || 1);
  const offset = (page - 1) * PAGE_BATCH;
  // Only known statuses are forwarded; free-text search is trimmed and capped
  // to the backend's own 100-char limit.
  const status = (VIGILANCE_FILTER_STATUSES as readonly string[]).includes(searchParams?.status ?? "") ? searchParams?.status : undefined;
  const q = searchParams?.q?.trim().slice(0, 100) || undefined;
  const hasFilter = Boolean(status || q);

  // GAP-HR-VIGILANCE-01 (PII/DPDP decision packet): this page intentionally
  // does NOT pass includeDropped=true -- a dropped/exonerated case should
  // not reach the browser by default at all (truncated summary or not).
  const { data, source } = await getData(offset, { status, q });
  const errored = source === "error";
  const items: VigilanceRow[] = data.items.map((r) => ({
    id: r.id,
    // GAP-HR-VIGILANCE-06 (UUID): case_no is the real, stored case number --
    // the same case's disciplinary/[id] detail page shows it too, so the
    // fabricated "VIG/" + first-8-hex-chars reference (unrelated to case_no)
    // meant this list and that detail page disagreed on the case's own
    // number.
    caseRef: r.caseNo ?? "—",
    employee: r.employee,
    department: r.department,
    // Whether there is any charge text to reveal -- never the text itself.
    hasCharges: r.hasCharges ?? Boolean(r.charges_summary),
    inquiryOfficer: r.inquiryOfficer,
    nextHearing: r.nextHearing,
    status: r.status,
  }));

  // GAP-HR-VIGILANCE-02: stat-card buckets are computed server-side
  // (services/hrms-service/.../gap-features/routes.ts, from
  // VIGILANCE_STATUS_GROUPS), over every major case in the tenant -- not just
  // whatever page is currently loaded, so they stay exact once results are
  // paginated (GAP-HR-VIGILANCE-04) AND under a status/search filter. Charge
  // memo / under inquiry / penalty & appeal / closed / dropped are mutually
  // exclusive and exhaustive over all 10 CaseStatus values and sum to Total;
  // penalty and appeal stages are deliberately NOT counted as "under inquiry".
  const { chargeMemoStage, underInquiry, penaltyAndAppeal, closed, dropped } = data.stats;

  // GAP-HR-VIGILANCE-03 (DATEFMT): nextHearing (inquiry_appointed_date) was
  // rendered as a raw unformatted value and printed blank (not "—") when no
  // inquiry officer is appointed yet. cellType:"date" (in VigilanceTable) fixes
  // both via DataTable's existing formatIndianDate wiring. Backend aliases
  // inquiry_appointed_date (a one-time event) as "nextHearing" -- it is not a
  // recurring hearing schedule, so the column is labelled honestly until the
  // backend tracks real hearing dates.

  const pageHref = (p: number) => {
    const params = new URLSearchParams({ page: String(p) });
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    return `/hr/vigilance?${params.toString()}`;
  };

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        // GAP-HR-VIGILANCE-05 (NAV, depends on VIGILANCE-07): disciplinary's
        // list links here ("Vigilance Only") but this page had no way back
        // to the full register -- an empty <span/> actions slot with
        // back="/hr" skipped disciplinary entirely.
        actions={<Link href="/hr/disciplinary" className="btn-outline">{t("allDisciplinary")}</Link>}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="⚖️" iconBg="var(--infobg)" label={t("statTotalCasesLabel")} value={errored ? null : data.stats.total} />
        <StatCard icon="🔴" iconBg="var(--badbg)" label={t("statChargeMemoStageLabel")} value={errored ? null : chargeMemoStage} />
        <StatCard icon="🔍" iconBg="var(--warnbg)" label={t("statUnderInquiryLabel")} value={errored ? null : underInquiry} />
        <StatCard icon="⚖️" iconBg="var(--primary-soft)" label={t("statPenaltyAppealLabel")} value={errored ? null : penaltyAndAppeal} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statClosedLabel")} value={errored ? null : closed} />
        <StatCard icon="🚫" iconBg="var(--bg)" label={t("statDroppedLabel")} value={errored ? null : dropped} />
      </StatGrid>
      {/* GAP-HR-VIGILANCE-01 (PII/DPDP): purpose/confidentiality notice above
          the table -- mirrors the styling of the existing DPDP notice in
          citizen/grievances/new/page.tsx. */}
      <div
        role="note"
        aria-labelledby="vigilance-confidential-heading"
        style={{
          marginTop: 20,
          padding: "14px 16px",
          borderRadius: 8,
          border: "1px solid #d1a700",
          background: "#fffbea",
        }}
      >
        <p
          id="vigilance-confidential-heading"
          style={{ margin: "0 0 6px 0", fontWeight: 600, fontSize: "0.875rem", color: "#7a5200" }}
        >
          {t("confidentialBannerTitle")}
        </p>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "#5c4000", lineHeight: 1.5 }}>
          {t("confidentialBannerBody")}
        </p>
      </div>
      {/* GAP-HR-VIGILANCE-04: status and search run on the backend, across every
          case in the tenant -- the table below only ever holds one batch, so a
          client-side filter could never reach case 201+. Search covers case
          ref, employee, department and inquiry officer; never the charge text. */}
      <form
        method="GET"
        role="search"
        aria-label={t("filterFormLabel")}
        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "16px 0" }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="vigilance-status" style={{ fontSize: 12, fontWeight: 600 }}>{t("filterStatusLabel")}</label>
          <select id="vigilance-status" name="status" defaultValue={status ?? ""}>
            <option value="">{t("filterAllStatuses")}</option>
            {VIGILANCE_FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>{humanizeStatus(s)}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="vigilance-q" style={{ fontSize: 12, fontWeight: 600 }}>{t("filterSearchLabel")}</label>
          <input id="vigilance-q" type="search" name="q" maxLength={100} defaultValue={q ?? ""} placeholder={t("filterPlaceholder")} style={{ minWidth: 280 }} />
        </div>
        <button type="submit" className="btn">{t("applyFilter")}</button>
        {hasFilter && <Link href="/hr/vigilance" className="btn-outline">{t("clearFilter")}</Link>}
      </form>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "vigilance" })} backHref="/hr" />
          </div>
        ) : (<>
          {hasFilter && (
            <p role="status" style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 8px" }}>
              {t("resultsCount", { total: data.total })}
            </p>
          )}
          {/* Rows link to the shared disciplinary detail page (a vigilance case
              IS a disciplinary case, proceeding_type='major', gated by the exact
              same role list) with ?from=vigilance, so its Back link returns
              here (GAP-HR-VIGILANCE-05). The charge column is a masked,
              click-to-reveal control (GAP-HR-VIGILANCE-01). */}
          <VigilanceTable
            rows={items}
            labels={{
              caseRef: t("colCaseRef"),
              employee: t("colEmployee"),
              department: t("colDepartment"),
              charges: t("colChargeSummary"),
              inquiryOfficer: t("colInquiryOfficer"),
              inquiryOfficerAppointed: t("colInquiryOfficerAppointed"),
              status: t("colStatus"),
              noCharges: t("noCharges"),
              emptyTitle: hasFilter ? t("emptyFilteredTitle") : t("emptyTitle"),
              emptyMessage: hasFilter ? t("emptyFilteredMessage") : t("emptyMessage"),
              caption: t("cardTitle"),
            }}
          />
          {/* GAP-HR-VIGILANCE-04: this batch (up to PAGE_BATCH rows) may not be
              everything -- hasMore/page step to the next server batch, keeping
              the active status/search filter. */}
          {(page > 1 || data.hasMore) && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="btn-outline">
                  ← {t("prevBatch")}
                </Link>
              ) : <span />}
              {data.hasMore ? (
                <Link href={pageHref(page + 1)} className="btn-outline">
                  {t("nextBatch")} →
                </Link>
              ) : <span />}
            </div>
          )}
        </>)}
      </Card>
    </div>
  );
}
