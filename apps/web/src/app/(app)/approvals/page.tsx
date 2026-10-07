import Link from "next/link";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "../../_components/ds";
import { RefreshErrorState } from "../../_components/ds/RefreshErrorState";
import { getMyApprovals } from "../../_data/loaders";
import { ApprovalsTable } from "./_components/ApprovalsTable";
import { isTaskOverdue, countOverdue } from "./_components/overdue";

const PAGE_SIZE = 15;

type SearchParams = { page?: string | string[] };

function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export default async function MyApprovalsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const page = parsePage(searchParams?.page);
  const { data, source } = await getMyApprovals(page, PAGE_SIZE);
  const failed = source === "error";
  const approvals = data.items;

  const now = Date.now();
  // GAP-APPROVALS-HOME-01: the Pending stat is the WHOLE pending count the API
  // reports, not just this page's length (which silently capped it). When the
  // service omits a total we fall back to the loaded count (and only then is it
  // page-bounded).
  const pending = data.total ?? approvals.length;
  // GAP-APPROVALS-HOME-06: Overdue/Due-soon are computed from the loaded rows
  // with the SAME shared helper the table uses, so the tiles and the red rows
  // can never disagree. They describe the loaded page; the notice below makes
  // the "first N of M" scope explicit.
  const overdue = countOverdue(approvals, now);
  const dueSoon = approvals.filter(
    (a) => !isTaskOverdue(a.dueDate, now) && a.dueDate !== null && new Date(a.dueDate).getTime() - now <= 7 * 86400000,
  ).length;
  const modules = new Set(approvals.map((a) => a.module));

  const loadedUpTo = (page - 1) * PAGE_SIZE + approvals.length;
  const total = data.total;
  const hasPrev = page > 1;
  const hasNext = data.hasMore;
  const showScopeNotice = !failed && total !== null && total > approvals.length;

  return (
    <>
      <PageHeader
        title="My Approvals"
        subtitle="All pending items requiring your action across modules."
        back="/dashboard"
        backLabel="Dashboard"
        help="approvals"
        actions={failed ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        {/* On a failed load a hard 0 reads as "nothing to do" next to an error
            card — gate every tile to "—" instead (GAP-APPROVALS-HOME-03). */}
        <StatCard icon="⏳" tone="info" label="Pending" value={failed ? null : pending} />
        <StatCard icon="⚠️" tone="bad" label="Overdue" value={failed ? null : overdue} />
        <StatCard icon="📋" tone="neutral" label="Modules" value={failed ? null : modules.size} />
        {/* GAP-APPROVALS-HOME-06: a distinct metric, not a duplicate of Pending. */}
        <StatCard icon="📅" tone="warn" label="Due within 7 days" value={failed ? null : dueSoon} />
      </StatGrid>

      <Card title="Pending Approvals">
        {failed ? (
          <RefreshErrorState
            error={{
              what: "We couldn't load your approvals.",
              next: "The workflow service didn't respond. Try again in a moment.",
              actions: ["retry", "back"],
            }}
            backHref="/dashboard"
            source={{ area: "approvals" }}
          />
        ) : approvals.length === 0 ? (
          <EmptyState
            icon="✅"
            title="No pending approvals"
            message="You're all caught up. No items need your attention right now."
          />
        ) : (
          <>
            {showScopeNotice && (
              <p role="status" style={{ fontSize: 13, color: "var(--mut, #64748b)", marginBottom: 8 }}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{loadedUpTo} of {total}.
              </p>
            )}
            <ApprovalsTable initialData={approvals} source={source} />
            {(hasPrev || hasNext) && (
              <nav
                aria-label="Approvals pages"
                style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", marginTop: 12 }}
              >
                {hasPrev ? (
                  <Link href={`/approvals?page=${page - 1}`} className="btn ghost">
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span style={{ fontSize: 13, color: "var(--mut, #64748b)" }}>Page {page}</span>
                {hasNext ? (
                  <Link href={`/approvals?page=${page + 1}`} className="btn ghost">
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </Card>
    </>
  );
}
