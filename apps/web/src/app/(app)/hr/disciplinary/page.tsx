import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

/**
 * Mirrors services/hrms-service/src/modules/gap-features/routes.ts's
 * HR_ROLES guard on GET /v1/hrms/disciplinary-cases exactly.
 */
const DISCIPLINARY_ROLES = ["hr_admin", "hr_officer", "super_admin"];

// GAP-HR-DISCIPLINARY-04: server batch size per fetch. DataTable's own
// pageSize=15 still paginates client-side *within* whichever batch is
// loaded; this is the outer, server-fetched window and matches the
// previous hardcoded LIMIT 200 exactly, so the default (page 1) view is
// unchanged -- only case #201+ (previously unreachable) now is.
const PAGE_BATCH = 200;

type RawRow = {
  id: string;
  caseNo: string | null;
  employee: string;
  department: string;
  proceeding_type: string;
  // GAP-HR-DISCIPLINARY-01 (PII/DPDP): the backend returns a truncated
  // summary in the list response, not the full allegation text -- that
  // stays on the case detail page (disciplinary/[id]/page.tsx), which has
  // its own role gate.
  charges_summary: string;
  filed_date: string;
  inquiry_officer: string;
  status: string;
} & Record<string, unknown>;

type Row = RawRow & { caseRef: string; type: string };

type Stats = { major: number; minor: number; open: number };
type ListPage = { items: RawRow[]; total: number; hasMore: boolean; stats: Stats };

const EMPTY_STATS: Stats = { major: 0, minor: 0, open: 0 };

async function getData(offset: number): Promise<LoaderResult<ListPage>> {
  return fetchJson<unknown, ListPage>(
    `/api/v1/hrms/disciplinary-cases?limit=${PAGE_BATCH}&offset=${offset}`,
    { items: [], total: 0, hasMore: false, stats: EMPTY_STATS },
    {
      telemetryKey: "hr.disciplinary",
      mapResponse: (p) => {
        const body = p as { data?: RawRow[]; total?: number; hasMore?: boolean; stats?: Stats } | null;
        if (!body || !Array.isArray(body.data)) return null;
        return {
          items: body.data,
          total: body.total ?? body.data.length,
          hasMore: body.hasMore ?? false,
          stats: body.stats ?? EMPTY_STATS,
        };
      },
    },
  );
}

export default async function DisciplinaryListPage({
  searchParams,
}: {
  searchParams?: { page?: string };
}) {
  const t = await getTranslations("disciplinary");
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => DISCIPLINARY_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="disciplinary cases" requiredRoles={DISCIPLINARY_ROLES} />;
  }

  // GAP-HR-DISCIPLINARY-04 (CAP): the old hard LIMIT 200 with no cursor made
  // case #201+ permanently unreachable and made the stat cards (previously
  // computed client-side from just those 200 rows) silently understate the
  // true total past 200 cases. `page` steps through PAGE_BATCH-sized server
  // batches; stats now come from the backend's own unconditional counts.
  const page = Math.max(1, Math.trunc(Number(searchParams?.page)) || 1);
  const offset = (page - 1) * PAGE_BATCH;

  const { data, source } = await getData(offset);
  const errored = source === "error";
  const items: Row[] = data.items.map((r) => ({
    ...r,
    // GAP-HR-DISCIPLINARY-02 (UUID): case_no is the real, stored case number
    // (disciplinary.hrms_disciplinary_cases.case_no, NOT NULL) -- the
    // fabricated "VIG/"/"GRV/" + first-8-hex-chars reference disagreed with
    // the detail page's own caseNo, so the same case had two different
    // "numbers" depending which screen you were on.
    caseRef: r.caseNo ?? "—",
    // GAP-HR-DISCIPLINARY-03 (terminology, decision packet auto-applied
    // default -- this item wasn't one of the ~30 flagged for a dedicated
    // card, so its own catalog fix step *is* the approved default): a minor
    // proceeding is a penalty proceeding against the employee, not a
    // grievance raised by one, and the real /hr/grievance register is an
    // unrelated, still-stubbed (always returns []) endpoint that can never
    // reconcile with it. Renamed to the CCS (CCA) terms; "Grievance"/"GRV/"
    // dropped entirely rather than building a real grievance register here
    // (that's the catalog's own separate, unscoped "if wanted" call).
    type: r.proceeding_type === "major" ? t("typeMajor") : t("typeMinor"),
  }));

  const { major, minor, open } = data.stats;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "date" }[] = [
    { key: "caseRef", label: t("colCaseRef") },
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "type", label: t("colType") },
    { key: "charges_summary", label: t("colCharge") },
    { key: "inquiry_officer", label: t("colOfficer") },
    // GAP-HR-DISCIPLINARY-05 (DATEFMT): filed_date is charge_memo_date,
    // which is null for a case still in "opened" state (no charge memo
    // issued yet) -- cellType:"date" renders that as "—" (formatIndianDate's
    // existing null convention) instead of a raw blank cell, and formats a
    // real date instead of an unformatted serialized value. Header renamed
    // to reflect what the column actually is (a charge-memo date, not a
    // generic "filed" date that every case has).
    { key: "filed_date", label: t("colFiled"), cellType: "date" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  // GAP-HR-DISCIPLINARY-01 (PII/DPDP): charges_summary still shows in the
  // table (as a truncated summary) but is out of the client-side search
  // scope, so filtering never has to scan allegation text -- searching
  // still works over every other column.
  const filterKeys = columns.filter((c) => c.key !== "charges_summary").map((c) => c.key);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        // GAP-HR-DISCIPLINARY-06 (WIRING): this looks like a filter toggle
        // next to the search box but is actually navigation to a different
        // page -- relabelled to say so plainly, with an aria-label spelling
        // out the destination for screen-reader users (the visible arrow
        // and label text alone already read as navigation, so this stays a
        // link rather than being converted into an in-place filter chip).
        actions={
          <Link href="/hr/vigilance" className="btn-outline" aria-label={t("vigilanceOnlyAriaLabel")}>
            {t("vigilanceOnly")} →
          </Link>
        }
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
<StatCard icon="⚖️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : major + minor} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statMajor")} value={errored ? null : major} />
        <StatCard icon="🟡" iconBg="var(--warnbg, #fffbe6)" label={t("statMinor")} value={errored ? null : minor} />
        <StatCard icon="📋" iconBg="var(--bg, #f5f5f5)" label={t("statOpen")} value={errored ? null : open} />
      </StatGrid>
      {/* GAP-HR-DISCIPLINARY-01 (PII/DPDP): purpose/confidentiality notice
          above the table -- mirrors the styling of the existing DPDP notice
          in citizen/grievances/new/page.tsx. */}
      <div
        role="note"
        aria-labelledby="disciplinary-confidential-heading"
        style={{
          marginTop: 20,
          padding: "14px 16px",
          borderRadius: 8,
          border: "1px solid #d1a700",
          background: "#fffbea",
        }}
      >
        <p
          id="disciplinary-confidential-heading"
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
            <RefreshErrorState error={toHumanError("load", { area: "disciplinary" })} backHref="/hr" />
          </div>
        ) : (<>

        {/* Regression fix: this table had no row-link props at all, so the
            fully-built disciplinary/[id] detail page (breadcrumbs, case
            fields, e-Office raise action) was completely unreachable except
            by hand-typing a case UUID into the URL. */}
        <DataTable<Row>
          columns={columns}
          rows={items}
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
        {/* GAP-HR-DISCIPLINARY-04: this batch (up to PAGE_BATCH rows) may
            not be everything -- hasMore/page step to the next server batch;
            DataTable's own pager above still handles paging within a
            batch. */}
        {(page > 1 || data.hasMore) && !errored && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            {page > 1 ? (
              <Link href={`/hr/disciplinary?page=${page - 1}`} className="btn-outline">
                ← {t("prevBatch")}
              </Link>
            ) : <span />}
            {data.hasMore ? (
              <Link href={`/hr/disciplinary?page=${page + 1}`} className="btn-outline">
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
