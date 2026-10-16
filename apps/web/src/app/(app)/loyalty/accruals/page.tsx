import Link from "next/link";
import { PageHeader } from "../../../_components/ds";
import { getLoyaltyAccruals } from "../_data";
import { MembersTable } from "../members/MembersTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** GAP-LOYALTY-MEMBERS-04: accruals page uses the same pager pattern as members. */
export default async function Page({ searchParams }: { searchParams?: { page?: string } }) {
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const { data, source } = await getLoyaltyAccruals({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

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
        title="Loyalty — Accruals"
        subtitle="Per-member points position: current balance and lifetime points earned."
        back="/loyalty"
        backLabel="Loyalty Programs"
      />
      {showCount && (
        <p role="status" style={{ fontSize: 13, color: "var(--mut, #64748b)", margin: "4px 0 4px" }}>
          Showing {(page - 1) * PAGE_SIZE + 1}–{loadedUpTo} of {total}.
        </p>
      )}
      <MembersTable rows={rows} source={source} variant="accruals" />
      {showPager && (
        <nav
          aria-label="Accruals pages"
          style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", marginTop: 12 }}
        >
          {hasPrev ? (
            <Link href={`/loyalty/accruals?page=${page - 1}`} className="btn ghost">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span style={{ fontSize: 13, color: "var(--mut, #64748b)" }}>Page {page}</span>
          {hasNext ? (
            <Link href={`/loyalty/accruals?page=${page + 1}`} className="btn ghost">
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
