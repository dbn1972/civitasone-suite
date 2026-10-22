import Link from "next/link";
import { PageHeader } from "../../../_components/ds";
import { getLoyaltyMembers } from "../_data";
import { MembersTable } from "./MembersTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * GAP-LOYALTY-MEMBERS-04: server-driven next/prev pager and "Showing x–y of n"
 * are now rendered from the loader's server-returned `total`. Client-side
 * search (DataTable filterable) is retained for filtering within the current
 * page; server-side ?q= search is not yet exposed by loyalty-service
 * (tracked for a future backend sprint: the enrolments list endpoint supports
 * only limit/offset/programId as of the current service version).
 */
export default async function Page({ searchParams }: { searchParams?: { page?: string; programId?: string } }) {
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const { data, source } = await getLoyaltyMembers({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    ...(searchParams?.programId ? { programId: searchParams.programId } : {}),
  });

  const rows = data.rows;
  const total = source === "error" ? null : data.total;
  const loadedUpTo = (page - 1) * PAGE_SIZE + rows.length;
  const hasPrev = page > 1;
  const hasNext = total !== null ? loadedUpTo < total : rows.length === PAGE_SIZE;
  const showPager = hasPrev || hasNext;
  const showCount = total !== null && total > rows.length;

  return (
    <div className="page-main">
      <PageHeader
        title="Loyalty — Members"
        subtitle="Member enrolments with tier status and point balances."
        back="/loyalty"
        backLabel="Loyalty Programs"
      />
      {showCount && (
        <p role="status" style={{ fontSize: 13, color: "var(--mut)", margin: "4px 0 4px" }}>
          Showing {(page - 1) * PAGE_SIZE + 1}–{loadedUpTo} of {total}.
        </p>
      )}
      <MembersTable rows={rows} source={source} variant="members" />
      {showPager && (
        <nav
          aria-label="Members pages"
          style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", marginTop: 12 }}
        >
          {hasPrev ? (
            <Link href={`/loyalty/members?page=${page - 1}`} className="btn ghost">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span style={{ fontSize: 13, color: "var(--mut)" }}>Page {page}</span>
          {hasNext ? (
            <Link href={`/loyalty/members?page=${page + 1}`} className="btn ghost">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
