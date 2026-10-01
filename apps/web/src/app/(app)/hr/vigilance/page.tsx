import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";

/**
 * Mirrors services/hrms-service/src/modules/gap-features/routes.ts's
 * HR_ROLES guard on GET /v1/hrms/vigilance exactly.
 */
const VIGILANCE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

// GAP-HR-VIGILANCE-04: server batch size per fetch -- see the matching
// constant/comment on hr/disciplinary/page.tsx.
const PAGE_BATCH = 200;

type RawRow = {
  id: string;
  caseNo: string | null;
  employee: string;
  department: string;
  // GAP-HR-VIGILANCE-01 (PII/DPDP): the backend returns a truncated summary
  // in the list response (same shape as GAP-HR-DISCIPLINARY-01), not the
  // full allegation text, and -- by default -- omits cases whose status is
  // 'dropped' (exonerated/discontinued) entirely. Full text and dropped
  // cases both remain reachable from the case detail page.
  charges_summary: string;
  filedDate: string;
  inquiryOfficer: string;
  nextHearing: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string };

type Stats = {
  chargeMemoStage: number; underInquiry: number; penaltyAndAppeal: number; closed: number; dropped: number; total: number;
};
type ListPage = { items: RawRow[]; total: number; hasMore: boolean; stats: Stats };

const EMPTY_STATS: Stats = { chargeMemoStage: 0, underInquiry: 0, penaltyAndAppeal: 0, closed: 0, dropped: 0, total: 0 };

async function getData(offset: number): Promise<LoaderResult<ListPage>> {
  return fetchJson<unknown, ListPage>(
    `/api/v1/hrms/vigilance?limit=${PAGE_BATCH}&offset=${offset}`,
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

export default async function VigilancePage({
  searchParams,
}: {
  searchParams?: { page?: string };
}) {
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

  // GAP-HR-VIGILANCE-01 (PII/DPDP decision packet): this page intentionally
  // does NOT pass includeDropped=true -- a dropped/exonerated case should
  // not reach the browser by default at all (truncated summary or not).
  const { data, source } = await getData(offset);
  const errored = source === "error";
  const items: Row[] = data.items.map((r) => ({
    ...r,
    // GAP-HR-VIGILANCE-06 (UUID): case_no is the real, stored case number --
    // the same case's disciplinary/[id] detail page shows it too, so the
    // fabricated "VIG/" + first-8-hex-chars reference (unrelated to case_no)
    // meant this list and that detail page disagreed on the case's own
    // number.
    caseRef: r.caseNo ?? "—",
  }));

  // GAP-HR-VIGILANCE-02: stat-card buckets are computed server-side
  // (services/hrms-service/.../gap-features/routes.ts, from
  // VIGILANCE_STATUS_GROUPS), over every major case in the tenant -- not just
  // whatever page is currently loaded, so they stay exact once results are
  // paginated (GAP-HR-VIGILANCE-04). Charge memo / under inquiry / penalty &
  // appeal / closed / dropped are mutually exclusive and exhaustive over all
  // 10 CaseStatus values and sum to Total; penalty and appeal stages are
  // deliberately NOT counted as "under inquiry".
  const { chargeMemoStage, underInquiry, penaltyAndAppeal, closed, dropped } = data.stats;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "date" }[] = [
    { key: "caseRef", label: t("colCaseRef") },
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "charges_summary", label: t("colChargeSummary") },
    { key: "inquiryOfficer", label: t("colInquiryOfficer") },
    // GAP-HR-VIGILANCE-03 (DATEFMT): nextHearing (inquiry_appointed_date) was
    // rendered as a raw unformatted value and printed blank (not "—") when
    // no inquiry officer is appointed yet. cellType:"date" fixes both via
    // DataTable's existing formatIndianDate wiring (shared with
    // GAP-HR-DISCIPLINARY-05 above).
    //
    // Backend aliases inquiry_appointed_date (a one-time event) as
    // "nextHearing" -- it is not a recurring hearing schedule, so a case
    // shows the same date forever after its inquiry officer is appointed,
    // regardless of how many hearings actually happen afterward. Labelled
    // honestly until the backend tracks real hearing dates.
    { key: "nextHearing", label: t("colInquiryOfficerAppointed"), cellType: "date" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  // GAP-HR-VIGILANCE-01 (PII/DPDP): same rationale as hr/disciplinary --
  // charges_summary stays visible in the table but out of client-side
  // search scope, so filtering never scans allegation text.
  const filterKeys = columns.filter((c) => c.key !== "charges_summary").map((c) => c.key);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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
        <StatCard icon="⚖️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalCasesLabel")} value={errored ? null : data.stats.total} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statChargeMemoStageLabel")} value={errored ? null : chargeMemoStage} />
        <StatCard icon="🔍" iconBg="var(--warnbg, #fffbe6)" label={t("statUnderInquiryLabel")} value={errored ? null : underInquiry} />
        <StatCard icon="⚖️" iconBg="var(--primary-soft, #faf5ff)" label={t("statPenaltyAppealLabel")} value={errored ? null : penaltyAndAppeal} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statClosedLabel")} value={errored ? null : closed} />
        <StatCard icon="🚫" iconBg="var(--bg, #f5f5f5)" label={t("statDroppedLabel")} value={errored ? null : dropped} />
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
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "vigilance" })} backHref="/hr" />
          </div>
        ) : (<>
          <DataTable<Row>
          columns={columns}
          rows={items}
          // Regression fix: this table had no row-link props at all, so a
          // vigilance case (a proceeding_type='major' disciplinary case --
          // see the status-enum comment above) had no way to reach its own
          // detail page from here. It already has one: the fully-built
          // disciplinary/[id] page (breadcrumbs, case fields, e-Office raise
          // action) is keyed by this same row's `id` and gated by the exact
          // same role list (VIGILANCE_ROLES here === DISCIPLINARY_ROLES
          // there), so rows link there -- mirroring hr/disciplinary/page.tsx's
          // own rowLinkKey/rowLinkPrefix wiring -- instead of duplicating a
          // second detail page for the same underlying case.
          rowLinkKey="id"
          rowLinkPrefix="/hr/disciplinary/"
          sortable
          filterable
          filterKeys={filterKeys}
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="⚖️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        {/* GAP-HR-VIGILANCE-04: this batch (up to PAGE_BATCH rows) may not be
            everything -- hasMore/page step to the next server batch. */}
        {(page > 1 || data.hasMore) && !errored && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            {page > 1 ? (
              <Link href={`/hr/vigilance?page=${page - 1}`} className="btn-outline">
                ← {t("prevBatch")}
              </Link>
            ) : <span />}
            {data.hasMore ? (
              <Link href={`/hr/vigilance?page=${page + 1}`} className="btn-outline">
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
