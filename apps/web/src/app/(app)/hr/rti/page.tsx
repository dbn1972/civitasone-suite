import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { FileRtiAction } from "./_components/FileRtiAction";

const RTI_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const PAGE_SIZE = 200;

type Row = {
  id: string;
  referenceNo: string;
  applicantName: string | null;
  subject: string;
  receivedDate: string;
  dueDate: string;
  status: string;
  overdue: boolean;
  daysToDue: number;
} & Record<string, unknown>;

type RowWithSla = Row & { slaLabel: string; applicantDisplay: string };

type Summary = { total: number; pending: number; overdue: number; disposed: number; appealed: number };

async function getData(offset: number): Promise<LoaderResult<{ items: Row[]; hasMore: boolean }>> {
  return fetchJson<unknown, { items: Row[]; hasMore: boolean }>(`/api/v1/hrms/rti/requests?limit=${PAGE_SIZE}&offset=${offset}`, { items: [], hasMore: false }, {
    telemetryKey: "hr.rti",
    mapResponse: (p) => {
      const body = p as { data?: Row[]; hasMore?: boolean };
      return Array.isArray(body?.data) ? { items: body.data, hasMore: Boolean(body.hasMore) } : null;
    },
  });
}

async function getSummary(): Promise<LoaderResult<Summary>> {
  const empty: Summary = { total: 0, pending: 0, overdue: 0, disposed: 0, appealed: 0 };
  return fetchJson<unknown, Summary>("/api/v1/hrms/rti/requests/summary", empty, {
    telemetryKey: "hr.rti_summary",
    mapResponse: (p) => {
      const body = (p as { data?: Summary })?.data;
      return body ?? null;
    },
  });
}

export default async function RtiPage({ searchParams }: { searchParams?: Record<string, string> }) {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => RTI_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="RTI requests" requiredRoles={RTI_ROLES} backHref="/hr" backLabel="Back to HR" />;
  }

  const t = await getTranslations("rtiRequests");
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [{ data, source }, { data: summary }] = await Promise.all([getData(offset), getSummary()]);
  const errored = source === "error";
  const { items, hasMore } = data;

  // GAP-HR-RTI-01: only "closed" had its own label before -- a "responded"
  // or "appealed" request past its ORIGINAL due date has overdue=false
  // (withSla only flags filed|assigned as overdue) and a negative
  // daysToDue, which rendered as nonsense ("-32 days left"). Switches on
  // status explicitly instead of falling through to the open-request math.
  // GAP-HR-RTI-03: applicantName is `null` for a masked row (routes.ts) --
  // shown as "Restricted" rather than blank/undefined.
  const rows: RowWithSla[] = items.map((item) => ({
    ...item,
    applicantDisplay: item.applicantName ?? t("restricted"),
    slaLabel:
      item.status === "closed"
        ? t("slaClosed")
        : item.status === "responded"
          ? t("slaResponded")
          : item.status === "appealed"
            ? t("slaAppealed")
            : item.overdue
              ? t("slaOverdueByDays", { days: Math.abs(item.daysToDue) })
              : t("slaDueInDays", { days: Math.max(0, item.daysToDue) }),
  }));

  const columns: { key: keyof RowWithSla & string; label: string; cellType?: "status" | "date" }[] = [
    { key: "referenceNo", label: t("colReferenceNo") },
    { key: "applicantDisplay", label: t("colApplicant") },
    { key: "subject", label: t("colSubject") },
    // GAP-HR-RTI-07: cellType "date" (DataTable) instead of the raw ISO
    // string DataTable's default cellValue() would otherwise print.
    { key: "receivedDate", label: t("colReceived"), cellType: "date" },
    { key: "dueDate", label: t("colDueDate"), cellType: "date" },
    { key: "slaLabel", label: t("colSla") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<FileRtiAction />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="📂" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? null : summary.total} />
        <StatCard icon="🔔" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? null : summary.pending} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statOverdueLabel")} value={errored ? null : summary.overdue} />
        {/* GAP-HR-RTI-02: "Under appeal" had no stat card at all -- first-
            appeal cases (their own statutory clock, RTI Act s.19) simply
            vanished from the summary before this. */}
        <StatCard icon="⚖️" iconBg="var(--bg, #f5f5f5)" label={t("statAppealedLabel")} value={errored ? null : summary.appealed} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statDisposedLabel")} value={errored ? null : summary.disposed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "rti" })} backHref="/hr" />
          </div>
        ) : (
          <>
            {/* GAP-HR-RTI-04: rows now link to a detail page with the actual
                assign/respond/appeal/close workflow -- DataTable's
                server-safe rowLinkKey/rowLinkPrefix, no client wrapper
                needed for this part. */}
            <DataTable<RowWithSla>
              columns={columns}
              rows={rows}
              rowLinkKey="id"
              rowLinkPrefix="/hr/rti/"
              identifyingColumnKey="referenceNo"
              sortable
              filterable
              filterKeys={["referenceNo", "applicantDisplay", "subject"]}
              filterPlaceholder={t("filterPlaceholder")}
              pageSize={15}
              emptyIcon="📂"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
            {/* GAP-HR-RTI-05: was a hard cap with no way to reach an older
                request past 200 -- a real "load next page" instead. */}
            {(hasMore || page > 1) && (
              <nav aria-label={t("paginationLabel")} style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
                {page > 1 && (
                  <Link href={`/hr/rti?page=${page - 1}`} className="btn ghost">← {t("prevPage")}</Link>
                )}
                <span style={{ alignSelf: "center", fontSize: 13, color: "var(--muted)" }}>
                  {t("pageIndicator", { page })}
                </span>
                {hasMore && (
                  <Link href={`/hr/rti?page=${page + 1}`} className="btn ghost">{t("nextPage")} →</Link>
                )}
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
