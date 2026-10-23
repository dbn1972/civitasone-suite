import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { FileIccComplaintAction } from "./_components/FileIccComplaintAction";
import { ICC_ACCESS_ROLES, ICC_IDENTITY_ROLES } from "@/lib/auth/workRoles";

/**
 * POSH Act 2013, §16 — "contents of the complaint made under section 9,
 * the identity and addresses of the aggrieved woman, respondent and
 * witnesses, any information relating to conciliation and inquiry
 * proceedings, recommendations of the Internal Committee … shall not be
 * published, communicated or made known to the public, press and media
 * in any manner."
 *
 * Only HR admins, super_admins, and nominated ICC members may access this
 * register. GAP-HR-ICC-01/02: complainantId/respondentId/createdBy/
 * tenantId/iccMembersOnly never leave the backend's list response at all
 * (icc-routes.ts's explicit column projection) -- this page no longer
 * needs to strip them itself, though the mapping below still names exactly
 * what it keeps, for the same reason the backend does: an explicit
 * allow-list, not a hope that nothing sensitive is present.
 */
const ICC_ROLES = ICC_ACCESS_ROLES;
const PAGE_SIZE = 100;

type Row = {
  id: string;
  caseNo: string;
  summary: string | null;
  filedAt: string;
  status: string;
  confidential: boolean;
};

type DisplayRow = { id: string; caseNo: string; summary: string; filedAt: string; status: string; confidential: boolean };

/** Whole-register stat-card counts, computed by the backend (GAP-HR-ICC-05). */
type Stats = { filed: number; underInquiry: number; disposed: number };
type ListPage = { items: Row[]; total: number; stats: Stats | null };

async function getData(offset: number): Promise<LoaderResult<ListPage>> {
  return fetchJson<unknown, ListPage>(`/api/v1/hrms/icc/complaints?limit=${PAGE_SIZE}&offset=${offset}`, { items: [], total: 0, stats: null }, {
    telemetryKey: "hr.icc",
    mapResponse: (p) => {
      const body = p as { data?: Row[]; total?: number; stats?: Partial<Stats> } | null;
      if (!Array.isArray(body?.data)) return null;
      const st = body?.stats;
      return {
        items: body.data,
        total: body.total ?? body.data.length,
        // Absent (an older backend) -> null, rendered as "—": never a count of just this page.
        stats: st && typeof st.filed === "number" && typeof st.underInquiry === "number" && typeof st.disposed === "number"
          ? { filed: st.filed, underInquiry: st.underInquiry, disposed: st.disposed }
          : null,
      };
    },
  });
}

export default async function IccPage(props: { searchParams?: Promise<Record<string, string>> }) {
  const searchParams = await props.searchParams;
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => ICC_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="ICC complaints (POSH Act)" requiredRoles={ICC_ROLES} backHref="/hr" backLabel="Back to HR" />;
  }
  // GAP-HR-ICC-02/03: only an icc_member can reach the identity-bearing
  // detail/hearing route (services/hrms-service's IDENTITY_ROLES) -- an
  // hr_admin/super_admin without that role would just get a 403 clicking
  // through, so the row link is offered only to sessions that can actually
  // use it.
  const canViewDetail = roles.some((r) => ICC_IDENTITY_ROLES.includes(r));

  const t = await getTranslations("icc");
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { data, source } = await getData(offset);
  const errored = source === "error";
  const { items: rawItems, total, stats } = data;

  // GAP-HR-ICC-01: explicit allow-list (defense in depth -- the backend
  // already never sends complainantId/respondentId/createdBy/tenantId/
  // iccMembersOnly, see icc-routes.ts), so nothing but these six fields is ever
  // handed to the client DataTable (and so into the RSC payload).
  // The free-text summary is shown ONLY to an icc_member (the same role that
  // may open the identity-bearing detail page) -- the backend already returns
  // null to anyone else, and this enforces it again here rather than trusting
  // that: an hr_admin / super_admin sees the opaque case-ref placeholder even if
  // a row's `confidential` flag is false. A missing flag is treated as
  // confidential (over-masking is the safe side, POSH s.16).
  const items: DisplayRow[] = rawItems.map((r) => ({
    id: r.id,
    caseNo: r.caseNo,
    filedAt: r.filedAt,
    status: r.status,
    confidential: r.confidential !== false,
    summary: canViewDetail && r.summary ? r.summary : t("confidentialSummaryPlaceholder", { caseNo: r.caseNo }),
  }));

  const hasConfidential = items.some((i) => i.confidential);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // GAP-HR-ICC-05: the stat cards come from the backend's whole-register counts
  // (like Total), never from filtering the <=100 rows of the current page.

  const columns: { key: keyof DisplayRow & string; label: string; cellType?: "status" | "date" }[] = [
    { key: "caseNo", label: t("colCaseRef") },
    { key: "summary", label: t("colSummary") },
    { key: "filedAt", label: t("colFiledDate"), cellType: "date" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<FileIccComplaintAction />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />

      {/* GAP-HR-ICC-07: was an sr-only aria-live div, announced only once at
          load and invisible to sighted users -- a visible notice, citing
          the actual statute, replaces it. */}
      {hasConfidential && (
        <div role="note" className="chip" style={{ marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden>🔒</span>
          {t("redactedNotice")}
        </div>
      )}

      <StatGrid>
        <StatCard icon="⚖️" iconBg="var(--infobg)" label={t("statTotalComplaintsLabel")} value={errored ? null : total} />
        <StatCard icon="🔔" iconBg="var(--warnbg)" label={t("statFiledLabel")} value={errored ? null : stats ? stats.filed : null} />
        <StatCard icon="🔍" iconBg="var(--badbg)" label={t("statUnderInquiryLabel")} value={errored ? null : stats ? stats.underInquiry : null} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statDisposedLabel")} value={errored ? null : stats ? stats.disposed : null} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "icc" })} backHref="/hr" />
          </div>
        ) : (
          <>
            <DataTable<DisplayRow>
              columns={columns}
              rows={items}
              {...(canViewDetail ? { rowLinkKey: "id" as const, rowLinkPrefix: "/hr/icc/" } : {})}
              identifyingColumnKey="caseNo"
              sortable
              filterable
              filterKeys={["caseNo", "status"]}
              filterPlaceholder={t("filterPlaceholder")}
              pageSize={15}
              emptyIcon="⚖️"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
            {totalPages > 1 && (
              <nav aria-label={t("paginationLabel")} style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
                {page > 1 && <Link href={`/hr/icc?page=${page - 1}`} className="btn ghost">← {t("prevPage")}</Link>}
                <span style={{ alignSelf: "center", fontSize: 13, color: "var(--muted)" }}>{t("pageOf", { page, totalPages })}</span>
                {page < totalPages && <Link href={`/hr/icc?page=${page + 1}`} className="btn ghost">{t("nextPage")} →</Link>}
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
