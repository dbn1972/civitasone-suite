export type ListSearchParams = {
  q?: string;
  page?: string;
  limit?: string;
};

export function paginateList<T>(rows: T[], searchParams: ListSearchParams) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(5, Number.parseInt(searchParams.limit ?? "10", 10) || 10));
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pageCount);
  const offset = (safePage - 1) * limit;
  return {
    rows: rows.slice(offset, offset + limit),
    total,
    page: safePage,
    limit,
    pageCount,
    q: searchParams.q?.trim() ?? "",
  };
}
