import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatCard, StatGrid, LoadErrorState } from "../../../_components/ds";
import { getCrmGrievances } from "../../../_data/loaders";
import { getSessionRoles, hasAnyRole, CRM_CONTACTS_EXPORT_ROLES } from "@/lib/auth/roleGuard";
import { GrievancesTable } from "./GrievancesTable";
import { GrievanceFilters } from "./GrievanceFilters";

type SP = { status?: string; priority?: string; search?: string; page?: string };

// Matches the loader default so the server pager and the API page size agree.
const PAGE_SIZE = 50;

export default async function GrievancesPage({ searchParams }: { searchParams?: SP }) {
  // The status/priority/search params used to be declared and then dropped on the
  // floor — the loader was called with no arguments, so a filtered URL returned
  // the unfiltered register. Filtering happens server-side because the API
  // paginates: narrowing client-side would only narrow the current page.
  //
  // GAP-CRM-GRIEVANCES-01: the API paginates at 50 rows/page but the page used
  // to request only page 1 and never render a pager, so any register beyond 50
  // grievances had unreachable records — overdue grievances could be silently
  // hidden. The page is now server-driven: `page` is read from the URL, passed
  // to the loader, and a Prev/Next pager under the table walks `data.total`.
  const t = await getTranslations("crmGrievancesList");
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const result = await getCrmGrievances({
    ...(searchParams?.status ? { status: searchParams.status } : {}),
    ...(searchParams?.priority ? { priority: searchParams.priority } : {}),
    ...(searchParams?.search ? { search: searchParams.search } : {}),
    page,
    limit: PAGE_SIZE,
  });
  const { data, source } = result;

  // GAP-CRM-GRIEVANCES-05: the register CSV carries citizen names (PII), so the
  // export control is only offered to roles with a need-to-know (DPDP data
  // minimisation). Decided server-side from the session roles.
  const canExport = hasAnyRole(getSessionRoles(), CRM_CONTACTS_EXPORT_ROLES);

  const rows = data.rows;
  const total = data.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Clamp the displayed page to what the register actually has, so a URL with
  // ?page=99 on a 2-page register still reports an honest window.
  const currentPage = Math.min(page, pageCount);
  const firstRow = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastRow = total === 0 ? 0 : firstRow + rows.length - 1;

  // Preserve the active filters when moving between pages; only `page` changes.
  const pageHref = (p: number): string => {
    const qs = new URLSearchParams();
    if (searchParams?.status) qs.set("status", searchParams.status);
    if (searchParams?.priority) qs.set("priority", searchParams.priority);
    if (searchParams?.search) qs.set("search", searchParams.search);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/crm/grievances?${s}` : "/crm/grievances";
  };

  // Counts are derived from the page the API returned, so they describe the
  // current view, not the register. `total` is the only figure that comes from
  // the server and is safe to present as a whole-register number.
  // CPGRAMS status vocabulary (services/crm-service grievances-domain.ts STATUS):
  // REGISTERED / FORWARDED / ATTENDED / DISPOSED / APPEAL. These filters used
  // to compare against a legacy open/escalated/resolved/closed vocabulary
  // that the backend has not returned since the CPGRAMS migration, so every
  // bucket here silently showed 0 regardless of the real register.
  const open = rows.filter((r) => r.status === "REGISTERED" || r.status === "FORWARDED" || r.status === "ATTENDED").length;
  const escalated = rows.filter((r) => r.status === "APPEAL").length;
  const resolved = rows.filter((r) => r.status === "DISPOSED").length;
  // GAP-CRM-GRIEVANCES-04: count of grievances on this page past their disposal
  // deadline and not yet disposed. Labelled "this page" like the other derived
  // tiles since it is computed from the fetched rows, not the whole register.
  const now = Date.now();
  const overdue = rows.filter(
    (r) => r.status !== "DISPOSED" && r.dueAt != null && !Number.isNaN(Date.parse(r.dueAt)) && Date.parse(r.dueAt) < now,
  ).length;
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        actions={
          <Link href="/crm/grievances/new" className="btn primary">
            {t("newGrievance")}
          </Link>
        }
      />
      {/* UX-012: the data-source badge now lives inside GrievancesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). The
          `stat()` "—" fallback above is unrelated and unchanged. */}

      <StatGrid>
        <StatCard icon="🔴" iconBg="color-mix(in srgb, var(--bad) 12%, transparent)" label={t("statOpen")} value={stat(open)} />
        <StatCard icon="⚠️" iconBg="color-mix(in srgb, var(--warn) 15%, transparent)" label={t("statFirstAppeal")} value={stat(escalated)} />
        <StatCard icon="⏰" iconBg="color-mix(in srgb, var(--bad) 12%, transparent)" label={t("statOverdue")} value={stat(overdue)} />
        <StatCard icon="✅" iconBg="color-mix(in srgb, var(--good) 12%, transparent)" label={t("statResolved")} value={stat(resolved)} />
        <StatCard icon="📋" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label={t("statTotal")} value={stat(data.total)} />
      </StatGrid>

      {/* GAP-CRM-GRIEVANCES-02: server-side filter controls. Status/priority/
          search are forwarded to the API; the client control writes the URL
          and resets to page 1. */}
      <GrievanceFilters
        status={searchParams?.status ?? ""}
        priority={searchParams?.priority ?? ""}
        search={searchParams?.search ?? ""}
      />

      {/* GAP-CRM-GRIEVANCES-03: on an outage, render an explicit retry error
          state instead of the table's "No grievances yet" first-use copy, which
          reads as an empty register and contradicts the "—" tiles above. */}
      {source === "error" ? (
        <LoadErrorState result={result} area="grievances" backHref="/crm" />
      ) : (
        <>
          {/* GAP-CRM-GRIEVANCES-01: honest whole-register window. `total` is the
              server figure; `firstRow`-`lastRow` describe the rows on this page. */}
          {total > 0 && (
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: "4px 0 8px" }}>
              {t("showing", {
                from: firstRow.toLocaleString("en-IN"),
                to: lastRow.toLocaleString("en-IN"),
                total: total.toLocaleString("en-IN"),
              })}
            </p>
          )}

          <GrievancesTable grievances={rows} source="api" page={currentPage} pageSize={PAGE_SIZE} canExport={canExport} />

          {/* Server-driven pager: the DataTable's own 15-row client pager only ever
              saw the current API page (<=50 rows), so pages 51+ were unreachable.
              These are plain links that re-run the server fetch for the next page,
              preserving the active filters. */}
          {pageCount > 1 && (
            <nav
              aria-label={t("pagesAriaLabel")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, margin: "16px 0" }}
            >
              {currentPage > 1 ? (
                <Link href={pageHref(currentPage - 1)} className="btn" rel="prev">
                  {t("previous")}
                </Link>
              ) : (
                <span className="btn" aria-disabled="true" style={{ opacity: 0.5, pointerEvents: "none" }}>
                  {t("previous")}
                </span>
              )}
              <span aria-live="polite" style={{ fontSize: 13, color: "var(--ink2)" }}>
                {t("pageOf", {
                  page: currentPage.toLocaleString("en-IN"),
                  pages: pageCount.toLocaleString("en-IN"),
                })}
              </span>
              {currentPage < pageCount ? (
                <Link href={pageHref(currentPage + 1)} className="btn" rel="next">
                  {t("next")}
                </Link>
              ) : (
                <span className="btn" aria-disabled="true" style={{ opacity: 0.5, pointerEvents: "none" }}>
                  {t("next")}
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
