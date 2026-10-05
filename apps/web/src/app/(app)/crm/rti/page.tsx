import Link from "next/link";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmRti } from "../../../_data/loaders";
import { RtiTable } from "./RtiTable";
import { RtiFilters } from "./RtiFilters";
import { rtiSlaBucket } from "./rtiStatus";
import { getTranslations } from "next-intl/server";

type SP = {
  status?: string;
  section?: string;
  search?: string;
  page?: string;
};

// Matches the loader default so the server pager and the API page size agree.
const PAGE_SIZE = 50;

export default async function RtiPage({
  searchParams,
}: {
  searchParams?: SP;
}) {
  // GAP-CRM-RTI-02: `page` is now URL-driven and passed to the loader, so RTI
  // requests beyond the first 50 are reachable. Filtering is server-side
  // because the API paginates — narrowing client-side would only narrow the
  // current page and leave the Total tile wrong.
  const t = await getTranslations("crmRtiList");
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const { data, source } = await getCrmRti({
    ...(searchParams?.status   ? { status: searchParams.status }   : {}),
    ...(searchParams?.section  ? { section: searchParams.section } : {}),
    ...(searchParams?.search   ? { search: searchParams.search }   : {}),
    page,
    limit: PAGE_SIZE,
  });

  const rows = data.rows;
  const total = data.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const firstRow = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastRow = total === 0 ? 0 : firstRow + rows.length - 1;

  // Preserve the active filters when moving between pages; only `page` changes.
  const pageHref = (p: number): string => {
    const qs = new URLSearchParams();
    if (searchParams?.status) qs.set("status", searchParams.status);
    if (searchParams?.section) qs.set("section", searchParams.section);
    if (searchParams?.search) qs.set("search", searchParams.search);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/crm/rti?${s}` : "/crm/rti";
  };

  // GAP-CRM-RTI-01: tile counts are status-aware. A RESPONDED/REJECTED/DISPOSED
  // request is no longer running against the 30-day clock, so it is never
  // counted as Overdue or Critical, and is excluded from Open. The buckets
  // (open-not-due / critical / overdue) partition the open rows, so Overdue +
  // Critical + not-due stays consistent with Open.
  const buckets = rows.map((r) => rtiSlaBucket(r.status, r.dueAt));
  const overdue = buckets.filter((b) => b === "overdue").length;
  const critical = buckets.filter((b) => b === "critical").length;
  const open = buckets.filter((b) => b !== "closed").length;
  const stat = (n: number) =>
    source === "error" ? "—" : n.toLocaleString("en-IN");

  return (
    <>
      <PageHeader
        title="RTI Requests"
        subtitle="Right to Information Act 2005 — 30-day statutory response register."
        back="/crm"
        actions={
          <Link href="/crm/rti/new" className="btn primary">
            + New RTI Request
          </Link>
        }
      />

      {/* UX-012: the data-source badge lives inside RtiTable, driven by the
          same useSeededResource call that produces its rows. */}

      <StatGrid>
        <StatCard
          icon="📋"
          iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)"
          label="Open (this page)"
          value={stat(open)}
        />
        <StatCard
          icon="🔴"
          iconBg="color-mix(in srgb, var(--bad) 12%, transparent)"
          label="Overdue (this page)"
          value={stat(overdue)}
        />
        <StatCard
          icon="⚠️"
          iconBg="color-mix(in srgb, var(--warn) 15%, transparent)"
          label="Critical — &lt;7 days (this page)"
          value={stat(critical)}
        />
        <StatCard
          icon="📁"
          iconBg="color-mix(in srgb, var(--good) 12%, transparent)"
          label="Total RTI Requests"
          value={stat(data.total)}
        />
      </StatGrid>

      {/* GAP-CRM-RTI-02: status / section / search controls that update the
          URL, so a filtered view is linkable and the Total tile reflects it. */}
      <RtiFilters
        status={searchParams?.status ?? ""}
        section={searchParams?.section ?? ""}
        search={searchParams?.search ?? ""}
      />

      {source !== "error" && total > 0 && (
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: "4px 0 8px" }}>
          {t("showing", {
            from: firstRow.toLocaleString("en-IN"),
            to: lastRow.toLocaleString("en-IN"),
            total: total.toLocaleString("en-IN"),
          })}
        </p>
      )}

      <RtiTable rows={rows} source={source === "error" ? "error" : "api"} page={currentPage} />

      {/* GAP-CRM-RTI-02: server-driven pager. The DataTable's own client pager
          only ever saw the current API page (<=50 rows), so pages 51+ were
          unreachable. These links re-run the server fetch, preserving filters. */}
      {source !== "error" && pageCount > 1 && (
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
  );
}
