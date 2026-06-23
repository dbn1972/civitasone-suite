import Link from "next/link";

type Props = {
  basePath: string;
  total: number;
  page: number;
  limit: number;
  pageCount: number;
  q?: string;
};

export function ListToolbar({ basePath, total, page, limit, pageCount, q = "" }: Props) {
  const prevPage = page > 1 ? page - 1 : null;
  const nextPage = page < pageCount ? page + 1 : null;

  function hrefFor(next: { page?: number; q?: string; limit?: number }) {
    const params = new URLSearchParams();
    const nextQ = next.q ?? q;
    const nextPageNum = next.page ?? page;
    const nextLimit = next.limit ?? limit;
    if (nextQ) params.set("q", nextQ);
    if (nextPageNum > 1) params.set("page", String(nextPageNum));
    if (nextLimit !== 10) params.set("limit", String(nextLimit));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
      <form method="GET" action={basePath} style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 220 }}>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search…"
          aria-label="Search list"
          style={{ flex: 1, fontSize: "0.8rem", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px" }}
        />
        <input type="hidden" name="limit" value={String(limit)} />
        <button type="submit" className="btn ghost" style={{ fontSize: "0.8rem", padding: "4px 10px" }}>Search</button>
        {q ? <Link href={basePath} style={{ fontSize: "0.8rem", color: "#4f46e5" }}>Clear</Link> : null}
      </form>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.8rem", color: "#64748b" }}>
        <span>{from}–{to} of {total}</span>
        {prevPage ? (
          <Link href={hrefFor({ page: prevPage })} className="btn ghost" style={{ fontSize: "0.75rem", padding: "4px 8px" }}>Prev</Link>
        ) : (
          <span className="btn ghost" style={{ fontSize: "0.75rem", padding: "4px 8px", opacity: 0.4 }}>Prev</span>
        )}
        <span>Page {page}/{pageCount}</span>
        {nextPage ? (
          <Link href={hrefFor({ page: nextPage })} className="btn ghost" style={{ fontSize: "0.75rem", padding: "4px 8px" }}>Next</Link>
        ) : (
          <span className="btn ghost" style={{ fontSize: "0.75rem", padding: "4px 8px", opacity: 0.4 }}>Next</span>
        )}
      </div>
    </div>
  );
}
