import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { FileIccComplaintAction } from "./_components/FileIccComplaintAction";

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
const ICC_ROLES = ["hr_admin", "super_admin", "icc_member"];
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

async function getData(offset: number): Promise<LoaderResult<{ items: Row[]; total: number }>> {
  return fetchJson<unknown, { items: Row[]; total: number }>(`/api/v1/hrms/icc/complaints?limit=${PAGE_SIZE}&offset=${offset}`, { items: [], total: 0 }, {
    telemetryKey: "hr.icc",
    mapResponse: (p) => {
      const body = p as { data?: Row[]; total?: number };
      return Array.isArray(body?.data) ? { items: body.data, total: body.total ?? body.data.length } : null;
    },
  });
}

export default async function IccPage({ searchParams }: { searchParams?: Record<string, string> }) {
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
  const canViewDetail = roles.includes("icc_member");

  const t = await getTranslations("icc");
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { data, source } = await getData(offset);
  const errored = source === "error";
  const { items: rawItems, total } = data;

  // GAP-HR-ICC-01: explicit allow-list (defense in depth -- the backend
  // already never sends complainantId/respondentId/createdBy/tenantId/
  // iccMembersOnly, see icc-routes.ts). A `null` summary (backend-masked)
  // renders the same opaque case-ref placeholder as before.
  const items: DisplayRow[] = rawItems.map((r) => ({
    id: r.id,
    caseNo: r.caseNo,
    filedAt: r.filedAt,
    status: r.status,
    confidential: r.confidential,
    summary: r.summary ?? t("confidentialSummaryPlaceholder", { caseNo: r.caseNo }),
  }));

  const hasConfidential = items.some((i) => i.confidential);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filed = items.filter((i) => i.status === "filed").length;
  const inquiry = items.filter((i) => i.status === "inquiry" || i.status === "under_inquiry").length;
  const closed = items.filter((i) => ["closed", "disposed", "withdrawn"].includes(i.status)).length;

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
        <StatCard icon="⚖️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalComplaintsLabel")} value={errored ? null : total} />
        <StatCard icon="🔔" iconBg="var(--warnbg, #fffbe6)" label={t("statFiledLabel")} value={errored ? null : filed} />
        <StatCard icon="🔍" iconBg="var(--badbg, #fff1f0)" label={t("statUnderInquiryLabel")} value={errored ? null : inquiry} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statDisposedLabel")} value={errored ? null : closed} />
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
